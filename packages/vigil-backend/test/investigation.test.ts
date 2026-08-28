import { describe, expect, it } from "vitest";
import { buildAgentSpec } from "../src/agent.js";
import { HarnessError } from "../src/harness.js";
import type { AgentSpec, HarnessEvent, HarnessGateway } from "../src/harness.js";
import { IncidentStore } from "../src/incident.js";
import {
  backoffMs,
  Investigation,
  looksLikeJson,
  parseArguments,
  textOf,
} from "../src/investigation.js";

const SPEC: AgentSpec = buildAgentSpec({
  model: "google-gemini/gemini-3-5-flash",
  observabilityServer: "vigil-observability",
  deploysServer: "vigil-deploys",
});

class ScriptedGateway implements HarnessGateway {
  readonly inputs: unknown[][] = [];
  private readonly script: HarnessEvent[][];

  constructor(script: HarnessEvent[][]) {
    this.script = script;
  }

  async createSession(): Promise<string> {
    return "session-1";
  }

  async *streamTurn(_sessionId: string, input: unknown[]): AsyncIterable<HarnessEvent> {
    this.inputs.push(input);
    for (const event of this.script.shift() ?? []) {
      yield event;
    }
  }
}

function rollbackProposal(): HarnessEvent[] {
  return [
    {
      type: "model.message",
      id: "e1",
      thread_id: "main",
      content: "The replay proves v1.4.0 is the culprit",
      tool_calls: [
        {
          id: "call-1",
          function: {
            name: "rollback-deploy",
            arguments: JSON.stringify({ version: "v1.3.0", reason: "replay proved v1.4.0 bad" }),
          },
          tool_info: { type: "mcp", name: "rollback-deploy", server_name: "vigil-deploys" },
        },
      ],
    },
    { type: "tool.approval_required", id: "e2", thread_id: "main", tool_calls: [{ id: "call-1" }] },
    {
      type: "turn.done",
      id: "e3",
      thread_id: null,
      state: {
        status: "done",
        required_actions: [{ type: "tool.approval_required", tool_calls: [{ id: "call-1" }] }],
      },
    },
  ];
}

function build(script: HarnessEvent[][]): { store: IncidentStore; investigation: Investigation; gateway: ScriptedGateway } {
  const store = new IncidentStore();
  const gateway = new ScriptedGateway(script);
  const investigation = new Investigation({
    client: gateway,
    store,
    spec: SPEC,
    gatedTool: "rollback-deploy",
    timeoutMs: 5000,
    maxRetries: 2,
    retryDelayMs: 0,
  });
  return { store, investigation, gateway };
}

describe("Investigation", () => {
  it("pauses for approval and carries the proposed arguments onto the card", async () => {
    const { store, investigation } = build([rollbackProposal()]);
    await investigation.start("checkout error rate above 20 percent");
    await investigation.waitForIdle();

    const snapshot = store.get();
    expect(snapshot.status).toBe("awaiting_approval");
    expect(snapshot.pendingApproval).toMatchObject({
      toolCallId: "call-1",
      toolName: "rollback-deploy",
      serverName: "vigil-deploys",
      args: { version: "v1.3.0", reason: "replay proved v1.4.0 bad" },
    });
  });

  it("resumes with an approval item and resolves once the rollback runs", async () => {
    const { store, investigation, gateway } = build([
      rollbackProposal(),
      [
        {
          type: "tool.response",
          id: "e4",
          thread_id: "main",
          tool_call_id: "call-1",
          content: JSON.stringify({ changed: true, activeVersion: "v1.3.0" }),
        },
        { type: "model.message", id: "e5", thread_id: "main", content: "Recovery confirmed" },
        { type: "turn.done", id: "e6", thread_id: null, state: { status: "done", required_actions: [] } },
      ],
    ]);
    await investigation.start("alert");
    await investigation.waitForIdle();
    await investigation.decide("allow");
    await investigation.waitForIdle();

    expect(gateway.inputs[1]).toEqual([
      {
        type: "user.tool_approval",
        thread_id: "main",
        tool_call_id: "call-1",
        approval: { status: "allow" },
      },
    ]);
    const snapshot = store.get();
    expect(snapshot.status).toBe("resolved");
    expect(snapshot.summary).toBe("Recovery confirmed");
    expect(snapshot.pendingApproval).toBeNull();
  });

  it("sends the denial reason and stops without a rollback", async () => {
    const { store, investigation, gateway } = build([
      rollbackProposal(),
      [{ type: "turn.done", id: "e4", thread_id: null, state: { status: "done", required_actions: [] } }],
    ]);
    await investigation.start("alert");
    await investigation.waitForIdle();
    await investigation.decide("deny", "release manager is mid deploy");
    await investigation.waitForIdle();

    expect(gateway.inputs[1]).toEqual([
      {
        type: "user.tool_approval",
        thread_id: "main",
        tool_call_id: "call-1",
        approval: { status: "deny", reason: "release manager is mid deploy" },
      },
    ]);
    expect(store.get().status).toBe("denied");
  });

  it("records subagents, the sandbox and failed tool calls", async () => {
    const { store, investigation } = build([
      [
        { type: "sandbox.created", id: "s1", thread_id: null, sandbox_id: "sbx-9" },
        {
          type: "thread.created",
          id: "t1",
          thread_id: "child-1",
          title: "metrics",
          agent_info: { name: "metrics-investigator", input: "query metrics" },
        },
        {
          type: "model.message",
          id: "m1",
          thread_id: "child-1",
          tool_calls: [
            {
              id: "call-2",
              function: { name: "query-metrics", arguments: '{"window":"30m"}' },
              tool_info: { type: "mcp", name: "query-metrics", server_name: "vigil-observability" },
            },
          ],
        },
        {
          type: "tool.response",
          id: "r1",
          thread_id: "child-1",
          tool_call_id: "call-2",
          content: "The checkout service is unreachable",
        },
        {
          type: "thread.done",
          id: "t2",
          thread_id: "child-1",
          title: "metrics",
          state: { status: "done", output: { content: "no metrics available" } },
        },
        { type: "turn.done", id: "d1", thread_id: null, state: { status: "done", required_actions: [] } },
      ],
    ]);
    await investigation.start("alert");
    await investigation.waitForIdle();

    const snapshot = store.get();
    expect(snapshot.sandboxId).toBe("sbx-9");
    expect(snapshot.timeline.some((entry) => entry.kind === "subagent" && entry.state === "running")).toBe(true);
    expect(snapshot.timeline.some((entry) => entry.kind === "subagent" && entry.state === "ok")).toBe(true);
    expect(snapshot.timeline.find((entry) => entry.toolCallId === "call-2")?.state).toBe("error");
    expect(snapshot.status).toBe("failed");
  });

  it("retries a transient harness failure and gives up after the budget", async () => {
    const store = new IncidentStore();
    let attempts = 0;
    const investigation = new Investigation({
      client: {
        createSession: async () => "session-1",
        streamTurn: () => {
          attempts += 1;
          throw new HarnessError("model provider quota exhausted", 429);
        },
      },
      store,
      spec: SPEC,
      gatedTool: "rollback-deploy",
      timeoutMs: 5000,
      maxRetries: 2,
      retryDelayMs: 0,
    });
    await investigation.start("alert");
    await investigation.waitForIdle();

    expect(attempts).toBe(3);
    expect(store.get().status).toBe("failed");
    expect(store.get().error).toContain("quota exhausted");
    expect(store.get().timeline.filter((entry) => entry.title.startsWith("Retrying"))).toHaveLength(2);
  });

  it("assembles streamed message deltas into timeline entries and approval arguments", async () => {
    const { store, investigation } = build([
      [
        { type: "model.message", id: "m1", thread_id: "main" },
        { type: "model.message.delta", id: "m1", thread_id: "main", content: "Rolling back " },
        { type: "model.message.delta", id: "m1", thread_id: "main", content: "to v1.3.0" },
        {
          type: "model.message.delta",
          id: "m1",
          thread_id: "main",
          tool_calls: [
            {
              index: 0,
              id: "call-1",
              function: { name: "rollback-deploy", arguments: '{"version":"v1.' },
              tool_info: { type: "mcp", name: "rollback-deploy", server_name: "vigil-deploys" },
            },
          ],
        } as never,
        {
          type: "model.message.delta",
          id: "m1",
          thread_id: "main",
          tool_calls: [{ index: 0, function: { arguments: '3.0","reason":"replay proved it"}' } }],
          finish_reason: "tool_calls",
        } as never,
        { type: "tool.approval_required", id: "a1", thread_id: "main", tool_calls: [{ id: "call-1" }] },
        {
          type: "turn.done",
          id: "d1",
          thread_id: null,
          state: { status: "done", required_actions: [{ type: "tool.approval_required" }] },
        },
      ],
    ]);
    await investigation.start("alert");
    await investigation.waitForIdle();

    const snapshot = store.get();
    expect(snapshot.timeline.find((entry) => entry.kind === "agent")?.detail).toBe(
      "Rolling back to v1.3.0",
    );
    const toolEntry = snapshot.timeline.find((entry) => entry.kind === "tool");
    expect(toolEntry).toMatchObject({
      toolName: "rollback-deploy",
      serverName: "vigil-deploys",
      args: { version: "v1.3.0", reason: "replay proved it" },
    });
    expect(snapshot.pendingApproval?.args).toEqual({
      version: "v1.3.0",
      reason: "replay proved it",
    });
  });

  it("flushes an unfinished streamed message when the turn ends", async () => {
    const { store, investigation } = build([
      [
        { type: "model.message", id: "m1", thread_id: "main" },
        { type: "model.message.delta", id: "m1", thread_id: "main", content: "partial thought" },
        { type: "turn.done", id: "d1", thread_id: null, state: { status: "done", required_actions: [] } },
      ],
    ]);
    await investigation.start("alert");
    await investigation.waitForIdle();

    expect(store.get().summary).toBe("partial thought");
  });

  it("resumes the investigation after a transient failure clears", async () => {
    const { store, investigation, gateway } = build([
      [
        {
          type: "turn.done",
          id: "e0",
          thread_id: null,
          state: { status: "error", message: "Cannot connect to API: " },
        },
      ],
      rollbackProposal(),
    ]);
    await investigation.start("alert");
    await investigation.waitForIdle();

    expect(gateway.inputs[1]).toEqual([
      { type: "user.message", content: expect.stringContaining("Continue the investigation") },
    ]);
    expect(store.get().status).toBe("awaiting_approval");
  });

  it("does not retry a failure that is not transient", async () => {
    const store = new IncidentStore();
    let attempts = 0;
    const investigation = new Investigation({
      client: {
        createSession: async () => "session-1",
        streamTurn: async function* () {
          attempts += 1;
          yield {
            type: "turn.done",
            id: "e1",
            thread_id: null,
            state: { status: "error", message: "agent spec references an unknown MCP server" },
          } as never;
        },
      },
      store,
      spec: SPEC,
      gatedTool: "rollback-deploy",
      timeoutMs: 5000,
      maxRetries: 2,
      retryDelayMs: 0,
    });
    await investigation.start("alert");
    await investigation.waitForIdle();

    expect(attempts).toBe(1);
    expect(store.get().status).toBe("failed");
  });

  it("does not leave the incident stuck when the session cannot be created", async () => {
    const store = new IncidentStore();
    const investigation = new Investigation({
      client: {
        createSession: async () => {
          throw new HarnessError("session creation failed", 422);
        },
        streamTurn: async function* () {},
      },
      store,
      spec: SPEC,
      gatedTool: "rollback-deploy",
      timeoutMs: 5000,
    });
    await expect(investigation.start("alert")).rejects.toThrow(/session creation failed/);
    expect(store.get().status).toBe("failed");
  });

  it("rejects a second investigation while one is running", async () => {
    const { investigation } = build([rollbackProposal()]);
    await investigation.start("alert");
    await investigation.waitForIdle();
    await expect(investigation.start("another alert")).rejects.toThrow(/waiting for your approval/);
  });

  it("rejects a decision when nothing is pending", async () => {
    const { investigation } = build([]);
    await expect(investigation.decide("allow")).rejects.toThrow(/no action is waiting/);
  });
});

describe("event helpers", () => {
  it("reads text from string and part-array content", () => {
    expect(textOf("hello ")).toBe("hello");
    expect(textOf([{ type: "text", text: "a" }, { type: "text", text: "b" }])).toBe("ab");
    expect(textOf(null)).toBe("");
  });

  it("parses tool arguments defensively", () => {
    expect(parseArguments('{"version":"v1.3.0"}')).toEqual({ version: "v1.3.0" });
    expect(parseArguments(undefined)).toEqual({});
    expect(parseArguments("not json")).toEqual({ raw: "not json" });
    expect(parseArguments("[1,2]")).toEqual({ value: [1, 2] });
  });

  it("separates structured results from failure messages", () => {
    expect(looksLikeJson('{"ok":true}')).toBe(true);
    expect(looksLikeJson("[]")).toBe(true);
    expect(looksLikeJson("The checkout service is unreachable")).toBe(false);
    expect(looksLikeJson("{oops")).toBe(false);
  });
});

describe("backoffMs", () => {
  it("honours the delay the provider asked for", () => {
    expect(backoffMs("Please retry in 11.03s.", 1, 2000)).toBe(12030);
  });

  it("backs off exponentially when the provider gives no hint", () => {
    expect(backoffMs("socket hang up", 1, 2000)).toBe(2000);
    expect(backoffMs("socket hang up", 3, 2000)).toBe(8000);
  });

  it("caps the wait and stays immediate when disabled", () => {
    expect(backoffMs("Please retry in 600s", 1, 2000)).toBe(60000);
    expect(backoffMs("socket hang up", 9, 2000)).toBe(60000);
    expect(backoffMs("anything", 3, 0)).toBe(0);
  });
});
