import type { AgentSpec, HarnessEvent, HarnessGateway, HarnessToolCall } from "./harness.js";
import { HarnessError } from "./harness.js";
import type { IncidentStore } from "./incident.js";

interface PendingCall {
  id?: string;
  name?: string;
  serverName?: string;
  args: string;
}

interface PendingMessage {
  threadId: string;
  text: string;
  calls: Map<number, PendingCall>;
}

interface TrackedCall {
  toolName: string;
  serverName?: string;
  args: Record<string, unknown>;
  threadId: string;
}

export interface InvestigationOptions {
  client: HarnessGateway;
  store: IncidentStore;
  spec: AgentSpec;
  gatedTool: string;
  timeoutMs: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

const RETRYABLE_PATTERN =
  /cannot connect|econnreset|etimedout|socket hang up|429|quota|rate limit|unavailable|overloaded|internal error|timeout/i;

const MAX_BACKOFF_MS = 60_000;

const RESUME_PROMPT =
  "The previous step failed with a transient model API error. Continue the investigation from where you left off, reusing the evidence you already gathered.";

export class InvestigationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvestigationConflictError";
  }
}

export class Investigation {
  private readonly options: InvestigationOptions;
  private readonly calls = new Map<string, TrackedCall>();
  private readonly pending = new Map<string, PendingMessage>();
  private running: Promise<void> | null = null;
  private rollbackExecuted = false;
  private turnFailure: string | null = null;
  private retries = 0;

  constructor(options: InvestigationOptions) {
    this.options = options;
  }

  async start(alert: string): Promise<string> {
    const snapshot = this.options.store.get();
    if (snapshot.status === "investigating" || snapshot.status === "executing") {
      throw new InvestigationConflictError("an investigation is already running");
    }
    if (snapshot.status === "awaiting_approval") {
      throw new InvestigationConflictError("an investigation is waiting for your approval");
    }
    this.calls.clear();
    this.pending.clear();
    this.rollbackExecuted = false;
    this.retries = 0;
    const incidentId = this.options.store.start(alert);
    let sessionId: string;
    try {
      sessionId = await this.options.client.createSession(this.options.spec);
    } catch (error) {
      this.options.store.fail(describeError(error));
      throw error;
    }
    this.options.store.setSession(sessionId);
    this.running = this.execute(sessionId, [{ type: "user.message", content: alert }]);
    return incidentId;
  }

  async decide(decision: "allow" | "deny", reason?: string): Promise<void> {
    const snapshot = this.options.store.get();
    const pending = snapshot.pendingApproval;
    if (!pending || !snapshot.sessionId) {
      throw new InvestigationConflictError("no action is waiting for approval");
    }
    this.options.store.resolveApproval({
      decision,
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      ...(reason === undefined ? {} : { reason }),
      decidedAt: new Date().toISOString(),
    });
    const approval =
      decision === "allow"
        ? { status: "allow" as const }
        : { status: "deny" as const, ...(reason === undefined ? {} : { reason }) };
    this.running = this.execute(snapshot.sessionId, [
      {
        type: "user.tool_approval",
        thread_id: pending.threadId,
        tool_call_id: pending.toolCallId,
        approval,
      },
    ]);
  }

  async waitForIdle(): Promise<void> {
    let current = this.running;
    while (current) {
      await current;
      if (this.running === current) {
        return;
      }
      current = this.running;
    }
  }

  private async execute(sessionId: string, input: unknown[]): Promise<void> {
    let nextInput = input;
    for (;;) {
      const failure = await this.runTurn(sessionId, nextInput);
      if (failure === null) {
        return;
      }
      const maxRetries = this.options.maxRetries ?? 4;
      if (this.retries >= maxRetries || !RETRYABLE_PATTERN.test(failure)) {
        this.options.store.fail(failure);
        return;
      }
      this.retries += 1;
      const wait = backoffMs(failure, this.retries, this.options.retryDelayMs ?? 2000);
      this.options.store.append({
        kind: "status",
        threadId: "main",
        title: `Retrying in ${Math.round(wait / 1000)}s after a transient harness failure (${this.retries} of ${maxRetries})`,
        detail: failure,
      });
      await sleep(wait);
      nextInput = [{ type: "user.message", content: RESUME_PROMPT }];
    }
  }

  private async runTurn(sessionId: string, input: unknown[]): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    timer.unref?.();
    this.turnFailure = null;
    try {
      for await (const event of this.options.client.streamTurn(sessionId, input, controller.signal)) {
        this.handle(event);
      }
      return this.turnFailure;
    } catch (error) {
      return describeError(error);
    } finally {
      clearTimeout(timer);
    }
  }

  private handle(event: HarnessEvent): void {
    const store = this.options.store;
    const threadId = event.thread_id ?? "main";
    switch (event.type) {
      case "sandbox.created":
        if (event.sandbox_id) {
          store.setSandbox(event.sandbox_id);
        }
        break;
      case "model.message":
        if (textOf(event.content) || (event.tool_calls ?? []).length > 0) {
          this.emitMessage(threadId, textOf(event.content), toPendingCalls(event.tool_calls));
        } else {
          this.pending.set(event.id, { threadId, text: "", calls: new Map() });
        }
        break;
      case "model.message.delta":
        this.mergeDelta(event, threadId);
        break;
      case "tool.response":
        if (event.tool_call_id) {
          const content = typeof event.content === "string" ? event.content : "";
          const succeeded = looksLikeJson(content);
          store.updateByToolCallId(event.tool_call_id, {
            state: succeeded ? "ok" : "error",
            result: content,
          });
          if (succeeded) {
            this.observeRollback(event.tool_call_id);
          }
        }
        break;
      case "thread.created":
        store.append({
          kind: "subagent",
          threadId: event.thread_id ?? threadId,
          title: `Subagent started: ${event.agent_info?.name ?? event.title ?? "investigator"}`,
          ...(event.agent_info?.input ? { detail: event.agent_info.input } : {}),
          state: "running",
        });
        break;
      case "thread.done": {
        this.flushThread(event.thread_id ?? threadId);
        const output = textOf(event.state?.output?.content);
        store.append({
          kind: "subagent",
          threadId: event.thread_id ?? threadId,
          title: `Subagent finished: ${event.title ?? "investigator"}`,
          ...(output ? { detail: output } : {}),
          state: event.state?.status === "error" ? "error" : "ok",
        });
        break;
      }
      case "tool.approval_required":
        this.handleApprovalRequired(event, threadId);
        break;
      case "turn.done":
        this.flushAll();
        this.handleTurnDone(event);
        break;
      default:
        break;
    }
  }

  private mergeDelta(event: HarnessEvent, threadId: string): void {
    const buffered = this.pending.get(event.id) ?? { threadId, text: "", calls: new Map() };
    if (typeof event.content === "string") {
      buffered.text += event.content;
    }
    for (const call of event.tool_calls ?? []) {
      const delta = call as HarnessToolCall & { index?: number };
      const index = delta.index ?? 0;
      const slot = buffered.calls.get(index) ?? { args: "" };
      if (delta.id) {
        slot.id = delta.id;
      }
      const name = delta.tool_info?.name ?? delta.function?.name;
      if (name) {
        slot.name = name;
      }
      if (delta.tool_info?.server_name) {
        slot.serverName = delta.tool_info.server_name;
      }
      if (delta.function?.arguments) {
        slot.args += delta.function.arguments;
      }
      buffered.calls.set(index, slot);
    }
    this.pending.set(event.id, buffered);
    if (event.finish_reason) {
      this.flush(event.id);
    }
  }

  private flush(messageId: string): void {
    const buffered = this.pending.get(messageId);
    if (!buffered) {
      return;
    }
    this.pending.delete(messageId);
    this.emitMessage(buffered.threadId, buffered.text.trim(), [...buffered.calls.values()]);
  }

  private flushThread(threadId: string): void {
    for (const [id, buffered] of this.pending) {
      if (buffered.threadId === threadId) {
        this.flush(id);
      }
    }
  }

  private flushAll(): void {
    for (const id of [...this.pending.keys()]) {
      this.flush(id);
    }
  }

  private emitMessage(threadId: string, text: string, calls: PendingCall[]): void {
    const store = this.options.store;
    if (text) {
      store.append({ kind: "agent", threadId, title: "Vigil", detail: text });
      if (threadId === "main") {
        store.setSummary(text);
      }
    }
    for (const call of calls) {
      if (!call.id) {
        continue;
      }
      const toolName = call.name ?? "tool";
      const args = parseArguments(call.args);
      this.calls.set(call.id, {
        toolName,
        ...(call.serverName ? { serverName: call.serverName } : {}),
        args,
        threadId,
      });
      store.append({
        kind: "tool",
        threadId,
        title: toolName,
        toolName,
        toolCallId: call.id,
        ...(call.serverName ? { serverName: call.serverName } : {}),
        args,
        state: "running",
      });
    }
  }

  private handleApprovalRequired(event: HarnessEvent, threadId: string): void {
    const first = event.tool_calls?.[0];
    if (!first) {
      return;
    }
    const tracked = this.calls.get(first.id);
    this.options.store.requestApproval({
      toolCallId: first.id,
      threadId: tracked?.threadId ?? threadId,
      toolName: tracked?.toolName ?? this.options.gatedTool,
      ...(tracked?.serverName ? { serverName: tracked.serverName } : {}),
      args: tracked?.args ?? {},
      requestedAt: event.created_at ?? new Date().toISOString(),
    });
  }

  private handleTurnDone(event: HarnessEvent): void {
    const store = this.options.store;
    const state = event.state;
    if (state?.status === "error") {
      this.turnFailure = state.message ?? state.error ?? "the harness ended the turn with an error";
      return;
    }
    if (state?.status === "cancelled") {
      this.turnFailure = "the harness cancelled the turn";
      return;
    }
    const awaitingAction = (state?.required_actions ?? []).some(
      (action) => action.type === "tool.approval_required",
    );
    if (awaitingAction || store.get().pendingApproval) {
      return;
    }
    const snapshot = store.get();
    if (snapshot.status === "denied") {
      store.setStatus("denied");
      return;
    }
    store.setStatus(this.rollbackExecuted ? "resolved" : "failed");
    if (!this.rollbackExecuted && !snapshot.error) {
      store.append({
        kind: "status",
        threadId: "main",
        title: "Investigation ended without a rollback",
        detail: "Vigil finished the turn without executing the approval-gated rollback",
      });
    }
  }

  private observeRollback(toolCallId: string): void {
    if (this.calls.get(toolCallId)?.toolName === this.options.gatedTool) {
      this.rollbackExecuted = true;
    }
  }
}

function toPendingCalls(calls: HarnessEvent["tool_calls"]): PendingCall[] {
  return (calls ?? []).map((call) => {
    const toolCall = call as HarnessToolCall;
    const name = toolCall.tool_info?.name ?? toolCall.function?.name;
    const serverName = toolCall.tool_info?.server_name;
    const pending: PendingCall = { args: toolCall.function?.arguments ?? "" };
    if (toolCall.id) {
      pending.id = toolCall.id;
    }
    if (name) {
      pending.name = name;
    }
    if (serverName) {
      pending.serverName = serverName;
    }
    return pending;
  });
}

export function describeError(error: unknown): string {
  if (error instanceof HarnessError) {
    return `${error.message} (harness status ${error.status})`;
  }
  return error instanceof Error ? error.message : String(error);
}

export function textOf(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in part
          ? String((part as { text: unknown }).text)
          : "",
      )
      .join("")
      .trim();
  }
  return "";
}

export function parseArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return { raw };
  }
}

export function looksLikeJson(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return false;
  }
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function backoffMs(failure: string, attempt: number, base: number): number {
  if (base <= 0) {
    return 0;
  }
  const requested = /retry in ([\d.]+)\s*s/i.exec(failure);
  if (requested?.[1]) {
    const seconds = Number(requested[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(Math.round(seconds * 1000) + 1000, MAX_BACKOFF_MS);
    }
  }
  return Math.min(base * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
