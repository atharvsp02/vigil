import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { insertLog, openDatabase, listDeployRecords } from "../src/db.js";
import type { Db } from "../src/db.js";
import { computeMetrics, queryLogs } from "../src/metrics.js";
import { seedDeployHistory } from "../src/seed.js";
import { subtotalCents, MAX_SUBTOTAL_CENTS } from "../src/pricing.js";

const ADMIN_TOKEN = "test-admin-token";
const REPLAY_TOKEN = "test-replay-token";

let db: Db;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  db = openDatabase(":memory:");
  seedDeployHistory(db);
  let port = 0;
  const app = createApp({
    db,
    serviceName: "checkout",
    adminToken: ADMIN_TOKEN,
    replayToken: REPLAY_TOKEN,
    selfBaseUrl: () => `http://127.0.0.1:${port}`,
    echoLogsToStdout: false,
  });
  server = await new Promise<Server>((resolve) => {
    const started = app.listen(0, () => resolve(started));
  });
  port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
});

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("deploy history is stable across restarts", () => {
  it("does not move seeded timestamps when seeding runs again", () => {
    const before = listDeployRecords(db).map((d) => `${d.version}@${d.deployed_at}`);
    seedDeployHistory(db, new Date(Date.now() + 6 * 3_600_000));
    const after = listDeployRecords(db).map((d) => `${d.version}@${d.deployed_at}`);
    expect(after).toEqual(before);
  });

  it("keeps the active version across a reseed", () => {
    seedDeployHistory(db, new Date(Date.now() + 60_000));
    expect(listDeployRecords(db).filter((d) => d.active === 1)).toHaveLength(1);
  });
});

describe("cart arithmetic cannot overflow into an authorized order", () => {
  it("throws rather than returning a non-finite subtotal", () => {
    expect(() =>
      subtotalCents([{ sku: "A", quantity: 2, unitPriceCents: Number.MAX_VALUE }]),
    ).toThrow(RangeError);
  });

  it("rejects an oversized line item at the schema boundary", async () => {
    const response = await post("/checkout", {
      cartId: "cart_overflow",
      currency: "USD",
      items: [{ sku: "A", quantity: 2, unitPriceCents: 1e308 }],
    });
    expect(response.status).toBe(400);
  });

  it("never reports a null payable amount with a 200", async () => {
    const response = await post("/checkout", {
      cartId: "cart_big",
      currency: "USD",
      items: Array.from({ length: 100 }, () => ({
        sku: "A",
        quantity: 10_000,
        unitPriceCents: 100_000_000,
      })),
    });
    expect(response.status).toBe(400);
    expect(MAX_SUBTOTAL_CENTS).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});

describe("observability query validation", () => {
  it("rejects an out-of-range window instead of returning 500", async () => {
    const response = await fetch(`${baseUrl}/metrics?window=99999h`);
    expect(response.status).toBe(400);
  });

  it("rejects a window longer than the retention bound", async () => {
    const response = await fetch(`${baseUrl}/metrics?window=99999m`);
    expect(response.status).toBe(400);
  });

  it("rejects an inverted metrics range rather than reporting zero traffic", async () => {
    const response = await fetch(
      `${baseUrl}/metrics?from=2026-08-26T10:00:00.000Z&to=2026-08-26T09:00:00.000Z`,
    );
    expect(response.status).toBe(400);
  });

  it("rejects an inverted logs range", async () => {
    const response = await fetch(
      `${baseUrl}/logs?since=2026-08-26T10:00:00.000Z&until=2026-08-26T09:00:00.000Z`,
    );
    expect(response.status).toBe(400);
  });

  it("still accepts a well-ordered explicit range", async () => {
    const response = await fetch(
      `${baseUrl}/metrics?from=2026-08-26T09:00:00.000Z&to=2026-08-26T10:00:00.000Z`,
    );
    expect(response.status).toBe(200);
  });
});

describe("latency percentiles use nearest-rank", () => {
  function seedLatencies(values: number[]): void {
    for (const [index, latency] of values.entries()) {
      insertLog(db, {
        ts: new Date(Date.now() - (values.length - index) * 1000).toISOString(),
        level: "info",
        service: "checkout",
        version: "v1.4.0",
        message: "checkout authorized",
        request_id: `req-${index}`,
        status_code: 200,
        latency_ms: latency,
        attributes: null,
      });
    }
  }

  it("reports the lower of two samples as p50", () => {
    seedLatencies([10, 20]);
    const from = new Date(Date.now() - 3_600_000).toISOString();
    const metrics = computeMetrics(db, "checkout", from, new Date().toISOString());
    expect(metrics.latencyP50Ms).toBe(10);
  });

  it("reports the 19th of twenty samples as p95", () => {
    seedLatencies(Array.from({ length: 20 }, (_unused, i) => (i + 1) * 10));
    const from = new Date(Date.now() - 3_600_000).toISOString();
    const metrics = computeMetrics(db, "checkout", from, new Date().toISOString());
    expect(metrics.latencyP95Ms).toBe(190);
  });
});

describe("log search treats wildcards literally", () => {
  beforeEach(() => {
    for (const message of ["discount 100% applied", "discount applied cleanly", "a_b matched"]) {
      insertLog(db, {
        ts: new Date().toISOString(),
        level: "warn",
        service: "checkout",
        version: "v1.4.0",
        message,
        request_id: null,
        status_code: null,
        latency_ms: null,
        attributes: null,
      });
    }
  });

  it("does not let % match arbitrary text", () => {
    const rows = queryLogs(db, { service: "checkout", search: "100%", limit: 50 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toBe("discount 100% applied");
  });

  it("does not let _ match an arbitrary character", () => {
    const rows = queryLogs(db, { service: "checkout", search: "a_b", limit: 50 });
    expect(rows.map((r) => r.message)).toEqual(["a_b matched"]);
  });
});
