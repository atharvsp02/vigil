import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";
import type { Db } from "../src/db.js";
import { seedDeployHistory } from "../src/seed.js";

const ADMIN_TOKEN = "test-admin-token";

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

const plainCart = {
  cartId: "cart_1",
  items: [{ sku: "A", quantity: 2, unitPriceCents: 1000 }],
  currency: "USD",
};

const discountCart = { ...plainCart, discountCode: "SAVE10" };

describe("GET /deploys", () => {
  it("returns the seeded history with the newest deploy active", async () => {
    const response = await fetch(`${baseUrl}/deploys`);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.active).toBe("v1.4.0");
    expect(body.deploys).toHaveLength(5);
    expect(body.deploys[0].version).toBe("v1.4.0");
  });
});

describe("POST /checkout on the faulty active deploy", () => {
  it("succeeds without a discount code", async () => {
    const response = await post("/checkout", plainCart);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.payableCents).toBe(2000);
  });

  it("returns 500 when a discount code is applied", async () => {
    const response = await post("/checkout", discountCart);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "payment_authorization_failed",
    });
  });

  it("rejects unknown discount codes before pricing", async () => {
    const response = await post("/checkout", { ...plainCart, discountCode: "FREESTUFF" });
    expect(response.status).toBe(422);
  });

  it("rejects a malformed cart", async () => {
    const response = await post("/checkout", { cartId: "x", items: [] });
    expect(response.status).toBe(400);
  });
});

describe("admin deploy activation", () => {
  it("requires the admin token", async () => {
    const response = await post("/admin/deploys/v1.3.0/activate", {});
    expect(response.status).toBe(401);
  });

  it("rejects an unknown version", async () => {
    const response = await post("/admin/deploys/v9.9.9/activate", {}, {
      "x-admin-token": ADMIN_TOKEN,
    });
    expect(response.status).toBe(404);
  });

  it("recovers checkout after rolling back to the previous deploy", async () => {
    await expect(post("/checkout", discountCart).then((r) => r.status)).resolves.toBe(500);

    const rollback = await post("/admin/deploys/v1.3.0/activate", {}, {
      "x-admin-token": ADMIN_TOKEN,
    });
    const rollbackBody = await rollback.json();
    expect(rollback.status).toBe(200);
    expect(rollbackBody).toMatchObject({
      changed: true,
      activeVersion: "v1.3.0",
      previousVersion: "v1.4.0",
    });

    const after = await post("/checkout", discountCart);
    const afterBody = await after.json();
    expect(after.status).toBe(200);
    expect(afterBody.payableCents).toBe(1800);
  });

  it("is idempotent when the target is already active", async () => {
    const response = await post("/admin/deploys/v1.4.0/activate", {}, {
      "x-admin-token": ADMIN_TOKEN,
    });
    await expect(response.json()).resolves.toMatchObject({ changed: false });
  });
});

describe("observability endpoints", () => {
  it("attributes the error rate to the faulty version", async () => {
    await post("/admin/load", { requests: 40, discountRatio: 0.5, concurrency: 5 }, {
      "x-admin-token": ADMIN_TOKEN,
    });

    const metrics = await fetch(`${baseUrl}/metrics?window=30m`).then((r) => r.json());
    expect(metrics.requestCount).toBeGreaterThan(0);
    expect(metrics.errorCount).toBeGreaterThan(0);
    expect(metrics.byVersion.some((entry: { version: string }) => entry.version === "v1.4.0")).toBe(
      true,
    );

    const logs = await fetch(`${baseUrl}/logs?level=error&limit=5`).then((r) => r.json());
    expect(logs.count).toBeGreaterThan(0);
    expect(logs.logs[0].version).toBe("v1.4.0");
    expect(logs.logs[0].message).toContain("payment authorization");
  });

  it("reports health with the active version", async () => {
    const health = await fetch(`${baseUrl}/health`).then((r) => r.json());
    expect(health).toMatchObject({ status: "ok", activeVersion: "v1.4.0" });
  });
});
