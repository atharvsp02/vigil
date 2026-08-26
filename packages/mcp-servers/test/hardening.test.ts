import { describe, expect, it } from "vitest";
import {
  CheckoutClient,
  CheckoutServiceInvalidResponseError,
  CheckoutServiceUnreachableError,
} from "@vigil/checkout-client";
import { loadRuntimeConfig, isLoopbackHost } from "../src/runtime/config.js";
import { guard } from "../src/runtime/results.js";
import { startMcpHttpServer } from "../src/runtime/server.js";

const BASE = { CHECKOUT_BASE_URL: "http://127.0.0.1:4000", PORT: "4101" };

describe("runtime config", () => {
  it("defaults to loopback so a server is not exposed by accident", () => {
    const config = loadRuntimeConfig({}, { ...BASE } as NodeJS.ProcessEnv);
    expect(config.HOST).toBe("127.0.0.1");
    expect(isLoopbackHost(config.HOST)).toBe(true);
  });

  it("refuses a routable host without a bearer token", () => {
    expect(() =>
      loadRuntimeConfig({}, { ...BASE, HOST: "0.0.0.0" } as NodeJS.ProcessEnv),
    ).toThrow(/MCP_BEARER_TOKEN is required when HOST is not loopback/);
  });

  it("allows a routable host once a bearer token is supplied", () => {
    const config = loadRuntimeConfig(
      {},
      { ...BASE, HOST: "0.0.0.0", MCP_BEARER_TOKEN: "x".repeat(24) } as NodeJS.ProcessEnv,
    );
    expect(config.HOST).toBe("0.0.0.0");
  });
});

describe("credentialed server startup", () => {
  it("refuses to start without a bearer token when it holds write credentials", async () => {
    await expect(
      startMcpHttpServer({
        name: "vigil-deploys",
        version: "0.1.0",
        instructions: "test",
        port: 0,
        host: "127.0.0.1",
        requireAuth: true,
        registerTools: () => undefined,
      }),
    ).rejects.toThrow(/refuses to start without MCP_BEARER_TOKEN/);
  });

  it("rejects an unauthenticated call when a token is configured", async () => {
    const server = await startMcpHttpServer({
      name: "vigil-deploys",
      version: "0.1.0",
      instructions: "test",
      port: 0,
      host: "127.0.0.1",
      bearerToken: "y".repeat(24),
      requireAuth: true,
      registerTools: () => undefined,
    });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });
      expect(response.status).toBe(401);
    } finally {
      await server.close();
    }
  });
});

describe("upstream failure is classified correctly", () => {
  function clientReturning(body: string, status = 200): CheckoutClient {
    return new CheckoutClient({
      baseUrl: "http://checkout.invalid",
      fetchImpl: (async () =>
        new Response(body, { status, headers: { "content-type": "application/json" } })) as
        typeof fetch,
    });
  }

  it("reports a non-JSON 200 as a contract failure, not a network failure", async () => {
    const client = clientReturning("<html>gateway</html>");
    await expect(client.metrics()).rejects.toBeInstanceOf(CheckoutServiceInvalidResponseError);
  });

  it("tells the agent a malformed body is upstream, not unreachable", async () => {
    const client = clientReturning("not json");
    const result = await guard(() => client.metrics());
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("not a network problem");
    expect(result.content[0]?.text).not.toContain("unreachable");
  });

  it("still reports genuine transport failures as unreachable", async () => {
    const client = new CheckoutClient({
      baseUrl: "http://checkout.invalid",
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as typeof fetch,
    });
    await expect(client.metrics()).rejects.toBeInstanceOf(CheckoutServiceUnreachableError);
    const result = await guard(() => client.metrics());
    expect(result.content[0]?.text).toContain("missing evidence");
  });
});
