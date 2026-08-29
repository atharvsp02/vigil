import { randomUUID } from "node:crypto";

export type IncidentStatus =
  | "idle"
  | "investigating"
  | "awaiting_approval"
  | "executing"
  | "resolved"
  | "denied"
  | "failed";

export type EntryKind =
  | "alert"
  | "agent"
  | "tool"
  | "subagent"
  | "sandbox"
  | "approval"
  | "decision"
  | "status";

export type EntryState = "running" | "ok" | "error";

export interface TimelineEntry {
  id: string;
  at: string;
  kind: EntryKind;
  threadId: string;
  title: string;
  detail?: string;
  toolName?: string;
  toolCallId?: string;
  serverName?: string;
  args?: unknown;
  result?: string;
  state?: EntryState;
  gated?: boolean;
}

export interface PendingApproval {
  toolCallId: string;
  threadId: string;
  toolName: string;
  serverName?: string;
  args: Record<string, unknown>;
  requestedAt: string;
}

export interface ApprovalOutcome {
  decision: "allow" | "deny";
  toolCallId: string;
  toolName: string;
  reason?: string;
  decidedAt: string;
}

export interface IncidentSnapshot {
  incidentId: string | null;
  status: IncidentStatus;
  alert: string | null;
  sessionId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  sandboxId: string | null;
  timeline: TimelineEntry[];
  pendingApproval: PendingApproval | null;
  approvals: ApprovalOutcome[];
  summary: string | null;
  error: string | null;
}

const MAX_RESULT_CHARS = 4000;

export class IncidentStore {
  private snapshot: IncidentSnapshot = emptySnapshot();
  private readonly listeners = new Set<(snapshot: IncidentSnapshot) => void>();

  get(): IncidentSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: IncidentSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(alert: string): string {
    const incidentId = randomUUID();
    this.snapshot = {
      ...emptySnapshot(),
      incidentId,
      status: "investigating",
      alert,
      startedAt: new Date().toISOString(),
    };
    this.append({ kind: "alert", threadId: "main", title: "Alert received", detail: alert });
    return incidentId;
  }

  setSession(sessionId: string): void {
    this.patch({ sessionId });
  }

  setStatus(status: IncidentStatus): void {
    const finishedAt = isTerminal(status) ? new Date().toISOString() : null;
    this.patch({ status, finishedAt });
  }

  fail(message: string): void {
    this.append({ kind: "status", threadId: "main", title: "Investigation failed", detail: message });
    this.patch({ status: "failed", error: message, finishedAt: new Date().toISOString() });
  }

  setSummary(summary: string): void {
    this.patch({ summary });
  }

  setSandbox(sandboxId: string): void {
    this.patch({ sandboxId });
    this.append({
      kind: "sandbox",
      threadId: "main",
      title: "Sandbox created",
      detail: `Isolated environment ${sandboxId} is ready for the deploy replay`,
    });
  }

  append(entry: Omit<TimelineEntry, "id" | "at"> & { id?: string; at?: string }): TimelineEntry {
    const created: TimelineEntry = {
      ...entry,
      id: entry.id ?? randomUUID(),
      at: entry.at ?? new Date().toISOString(),
    };
    this.patch({ timeline: [...this.snapshot.timeline, created] });
    return created;
  }

  updateByToolCallId(toolCallId: string, patch: Partial<TimelineEntry>): void {
    const timeline = this.snapshot.timeline.map((entry) => {
      if (entry.toolCallId !== toolCallId || entry.kind !== "tool") {
        return entry;
      }
      const result = truncate(patch.result ?? entry.result);
      return { ...entry, ...patch, ...(result === undefined ? {} : { result }) };
    });
    this.patch({ timeline });
  }

  requestApproval(approval: PendingApproval): void {
    this.patch({ pendingApproval: approval, status: "awaiting_approval" });
    this.updateByToolCallId(approval.toolCallId, { gated: true, state: "running" });
    this.append({
      kind: "approval",
      threadId: approval.threadId,
      title: "Holding for human approval",
      detail: `${approval.toolName} is destructive and cannot run until a person approves it`,
      toolCallId: approval.toolCallId,
      toolName: approval.toolName,
      args: approval.args,
    });
  }

  resolveApproval(outcome: ApprovalOutcome): void {
    this.patch({
      pendingApproval: null,
      approvals: [...this.snapshot.approvals, outcome],
      status: outcome.decision === "allow" ? "executing" : "denied",
    });
    this.append({
      kind: "decision",
      threadId: "main",
      title: outcome.decision === "allow" ? "Approved by human" : "Denied by human",
      ...(outcome.reason === undefined ? {} : { detail: outcome.reason }),
      toolCallId: outcome.toolCallId,
      toolName: outcome.toolName,
    });
  }

  private patch(patch: Partial<IncidentSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }
}

export function emptySnapshot(): IncidentSnapshot {
  return {
    incidentId: null,
    status: "idle",
    alert: null,
    sessionId: null,
    startedAt: null,
    finishedAt: null,
    sandboxId: null,
    timeline: [],
    pendingApproval: null,
    approvals: [],
    summary: null,
    error: null,
  };
}

export function isTerminal(status: IncidentStatus): boolean {
  return status === "resolved" || status === "denied" || status === "failed";
}

export function truncate(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value.length > MAX_RESULT_CHARS
    ? `${value.slice(0, MAX_RESULT_CHARS)}\n... truncated ${value.length - MAX_RESULT_CHARS} characters`
    : value;
}
