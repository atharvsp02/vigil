import { describe, expect, it, vi } from "vitest";
import { IncidentStore, isTerminal, truncate } from "../src/incident.js";

describe("IncidentStore", () => {
  it("starts an incident with the alert as the first entry", () => {
    const store = new IncidentStore();
    const incidentId = store.start("error rate spiked");
    const snapshot = store.get();
    expect(incidentId).toHaveLength(36);
    expect(snapshot.status).toBe("investigating");
    expect(snapshot.timeline).toHaveLength(1);
    expect(snapshot.timeline[0]?.kind).toBe("alert");
  });

  it("notifies subscribers on every change and stops after unsubscribe", () => {
    const store = new IncidentStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.start("alert");
    expect(listener).toHaveBeenCalled();
    const seen = listener.mock.calls.length;
    unsubscribe();
    store.setStatus("failed");
    expect(listener.mock.calls.length).toBe(seen);
  });

  it("updates only the matching tool entry", () => {
    const store = new IncidentStore();
    store.start("alert");
    store.append({ kind: "tool", threadId: "main", title: "query-metrics", toolCallId: "a", state: "running" });
    store.append({ kind: "tool", threadId: "main", title: "query-logs", toolCallId: "b", state: "running" });
    store.updateByToolCallId("a", { state: "ok", result: "{}" });
    const [, first, second] = store.get().timeline;
    expect(first?.state).toBe("ok");
    expect(second?.state).toBe("running");
  });

  it("marks the gated call and pauses when approval is required", () => {
    const store = new IncidentStore();
    store.start("alert");
    store.append({
      kind: "tool",
      threadId: "main",
      title: "rollback-deploy",
      toolCallId: "call-1",
      state: "running",
    });
    store.requestApproval({
      toolCallId: "call-1",
      threadId: "main",
      toolName: "rollback-deploy",
      args: { version: "v1.3.0" },
      requestedAt: new Date().toISOString(),
    });
    const snapshot = store.get();
    expect(snapshot.status).toBe("awaiting_approval");
    expect(snapshot.pendingApproval?.args).toEqual({ version: "v1.3.0" });
    expect(snapshot.timeline.find((entry) => entry.toolCallId === "call-1")?.gated).toBe(true);
  });

  it("records the decision and clears the pending approval", () => {
    const store = new IncidentStore();
    store.start("alert");
    store.requestApproval({
      toolCallId: "call-1",
      threadId: "main",
      toolName: "rollback-deploy",
      args: {},
      requestedAt: new Date().toISOString(),
    });
    store.resolveApproval({
      decision: "deny",
      toolCallId: "call-1",
      toolName: "rollback-deploy",
      reason: "waiting for the release manager",
      decidedAt: new Date().toISOString(),
    });
    const snapshot = store.get();
    expect(snapshot.pendingApproval).toBeNull();
    expect(snapshot.status).toBe("denied");
    expect(snapshot.approvals).toHaveLength(1);
  });

  it("stamps a finish time only for terminal states", () => {
    const store = new IncidentStore();
    store.start("alert");
    store.setStatus("executing");
    expect(store.get().finishedAt).toBeNull();
    store.setStatus("resolved");
    expect(store.get().finishedAt).not.toBeNull();
  });

  it("truncates oversized tool output", () => {
    expect(truncate(undefined)).toBeUndefined();
    expect(truncate("short")).toBe("short");
    const long = truncate("x".repeat(5000)) ?? "";
    expect(long.length).toBeLessThan(5000);
    expect(long).toContain("truncated");
  });

  it("classifies terminal states", () => {
    expect(isTerminal("resolved")).toBe(true);
    expect(isTerminal("denied")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("investigating")).toBe(false);
  });
});
