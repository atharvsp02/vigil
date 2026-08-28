import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildAgentSpec } from "../src/agent.js";
import { createApp, rateLimiter } from "../src/app.js";
import type { CheckoutGateway } from "../src/app.js";
import type { HarnessEvent, HarnessGateway } from "../src/harness.js";
import { IncidentStore } from "../src/incident.js";
import { Investigation } from "../src/investigation.js";

const SPEC = buildAgentSpec({
  model: "google-gemini/gemini-3-5-flash",
  observabilityServer: "vigil-observability",
  deploysServer: "vigil-deploys",
});

const PROPOSAL: HarnessEvent[] = [
  {
    type: "model.message",
    id: "e1",
    thread_id: "main",
    tool_calls: [
      {
        id: "call-1",
        function: { name: "rollback-deploy", arguments: '{"version":"v1.3.0"}' },
        tool_info: { type: "mcp", name: "rollback-deploy", server_name: "vigil-deploys" },
      },
    ],
  },
  { type: "tool.approval_required", id: "e2", thread_id: "main", tool_calls: [{ id: "call-1" }] },
  {
    type: "turn.done",
    id: "e3",
    thread_id: null,
    state: { status: "done", required_actions: [{ type: "tool.approval_required" }] },
  },
];

const gateway: HarnessGateway = {
  createSession: async () => "session-1",
  streamTurn: async function* () {
    for (const event of PROPOSAL) {
      yield event;
    }
  },
};

const checkout: CheckoutGateway = {
  metrics: async () => ({ from: "a", to: "b", service: "checkout", totals: {}, versions: [] }) as never,
  deploys: async () => ({ active: "v1.4.0", deploys: [] }) as never,
  activateDeploy: async (version: string) => ({ changed: true, activeVersion: version }) as never,
  generateLoad: async () => ({ requests: 10, succeeded: 7, failed: 3 }),
};

let server: Server;
let baseUrl: string;
let store: IncidentStore;

beforeEach(async () => {
  store = new IncidentStore();
  const app = createApp({
    store,
    investigation: new Investigation({
      client: gateway,
      store,
      spec: SPEC,
      gatedTool: "rollback-deploy",
      timeoutMs: 5000,
    }),
    checkout,
    dashboardOrigin: "http://localhost:3000",
  });
  server = await new Promise<Server>((resolve) => {
    const started = app.listen(0, () => resolve(started));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function waitForStatus(expected: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (store.get().status === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`status never reached ${expected}, last was ${store.get().status}`);
}

describe("vigil backend routes", () => {
  it("reports health and an idle snapshot", async () => {
    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    const state = await (await fetch(`${baseUrl}/api/state`)).json();
    expect(state).toMatchObject({ status: "idle", timeline: [], pendingApproval: null });
  });

  it("rejects an alert that is too short", async () => {
    const response = await post("/api/investigations", { alert: "short" });
    expect(response.status).toBe(400);
  });

  it("starts an investigation and refuses a concurrent one", async () => {
    const started = await post("/api/investigations", {});
    expect(started.status).toBe(202);
    await waitForStatus("awaiting_approval");
    const second = await post("/api/investigations", {});
    expect(second.status).toBe(409);
  });

  it("rejects an unknown decision and an approval with nothing pending", async () => {
    expect((await post("/api/approvals", { decision: "maybe" })).status).toBe(400);
    expect((await post("/api/approvals", { decision: "allow" })).status).toBe(409);
  });

  it("streams the current snapshot to a new subscriber", async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/stream`, { signal: controller.signal });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    const chunk = await reader?.read();
    const text = new TextDecoder().decode(chunk?.value);
    expect(text.startsWith("data: ")).toBe(true);
    expect(JSON.parse(text.slice(6))).toMatchObject({ status: "idle" });
    controller.abort();
  });

  it("triggers the seeded fault through the checkout service", async () => {
    const response = await post("/api/fault", { version: "v1.4.0", requests: 10 });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      activation: { activeVersion: "v1.4.0" },
      load: { failed: 3 },
    });
  });

  it("validates the metrics window and answers preflight requests", async () => {
    expect((await fetch(`${baseUrl}/api/service/metrics?window=forever`)).status).toBe(400);
    const preflight = await fetch(`${baseUrl}/api/state`, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });

  it("answers unknown routes with a not found body", async () => {
    const response = await fetch(`${baseUrl}/nope`);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
  });
});

describe("rateLimiter", () => {
  it("blocks callers that exceed the window budget and lets the window expire", () => {
    const limit = rateLimiter({ windowMs: 50, max: 2 });
    const calls: number[] = [];
    const res = {
      status(code: number) {
        calls.push(code);
        return { json: () => undefined };
      },
    } as never;
    const req = { ip: "1.2.3.4" } as never;
    let passed = 0;
    const next = (): void => {
      passed += 1;
    };
    limit(req, res, next);
    limit(req, res, next);
    limit(req, res, next);
    expect(passed).toBe(2);
    expect(calls).toEqual([429]);
  });
});
