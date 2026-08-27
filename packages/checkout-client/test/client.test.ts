import { describe, expect, it, vi } from "vitest";
import { CheckoutClient } from "../src/client.js";
import {
  CheckoutServiceError,
  CheckoutServiceInvalidResponseError,
  CheckoutServiceUnreachableError,
} from "../src/errors.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clientWith(impl: typeof fetch, adminToken?: string): CheckoutClient {
  return new CheckoutClient({
    baseUrl: "http://checkout.test/",
    fetchImpl: impl,
    ...(adminToken ? { adminToken } : {}),
  });
}

describe("url construction", () => {
  it("strips trailing slashes from the base url", async () => {
    const spy = vi.fn(async () => jsonResponse({ status: "ok" }));
    await clientWith(spy as unknown as typeof fetch).health();
    expect(spy.mock.calls[0]?.[0]).toBe("http://checkout.test/health");
  });

  it("omits undefined query parameters entirely", async () => {
    const spy = vi.fn(async () => jsonResponse({}));
    await clientWith(spy as unknown as typeof fetch).logs({ level: "error", version: undefined });
    expect(spy.mock.calls[0]?.[0]).toBe("http://checkout.test/logs?level=error");
  });

  it("sends no query string when there are no parameters", async () => {
    const spy = vi.fn(async () => jsonResponse({}));
    await clientWith(spy as unknown as typeof fetch).metrics();
    expect(spy.mock.calls[0]?.[0]).toBe("http://checkout.test/metrics");
  });

  it("percent-encodes the version in the activation path", async () => {
    const spy = vi.fn(async () => jsonResponse({ changed: true }));
    await clientWith(spy as unknown as typeof fetch, "tok").activateDeploy("v1/../admin");
    expect(spy.mock.calls[0]?.[0]).toBe(
      "http://checkout.test/admin/deploys/v1%2F..%2Fadmin/activate",
    );
  });
});

describe("privilege separation", () => {
  it("refuses to attempt a rollback without an admin token", async () => {
    const spy = vi.fn(async () => jsonResponse({}));
    await expect(
      clientWith(spy as unknown as typeof fetch).activateDeploy("v1.3.0"),
    ).rejects.toThrow(/requires an adminToken/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("sends the admin token only on the activation call", async () => {
    const spy = vi.fn(async () => jsonResponse({ changed: true }));
    const client = clientWith(spy as unknown as typeof fetch, "secret-token");
    await client.metrics();
    await client.activateDeploy("v1.3.0");
    const headersOnRead = (spy.mock.calls[0]?.[1] as RequestInit).headers;
    const headersOnWrite = (spy.mock.calls[1]?.[1] as RequestInit).headers;
    expect(headersOnRead).toEqual({});
    expect(headersOnWrite).toEqual({ "x-admin-token": "secret-token" });
  });
});

describe("error classification", () => {
  it("raises CheckoutServiceError on a non-2xx response", async () => {
    const impl = (async () => jsonResponse({ error: "unknown_version" }, 404)) as typeof fetch;
    await expect(clientWith(impl).deploys()).rejects.toBeInstanceOf(CheckoutServiceError);
  });

  it("preserves the upstream status and body for diagnosis", async () => {
    const impl = (async () => jsonResponse({ error: "nope" }, 422)) as typeof fetch;
    await clientWith(impl)
      .deploys()
      .catch((error: unknown) => {
        expect(error).toBeInstanceOf(CheckoutServiceError);
        const typed = error as CheckoutServiceError;
        expect(typed.status).toBe(422);
        expect(typed.body).toContain("nope");
      });
  });

  it("raises CheckoutServiceInvalidResponseError when a 200 body is not JSON", async () => {
    const impl = (async () => new Response("<html/>", { status: 200 })) as typeof fetch;
    await expect(clientWith(impl).metrics()).rejects.toBeInstanceOf(
      CheckoutServiceInvalidResponseError,
    );
  });

  it("raises CheckoutServiceUnreachableError when the transport fails", async () => {
    const impl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    await expect(clientWith(impl).metrics()).rejects.toBeInstanceOf(
      CheckoutServiceUnreachableError,
    );
  });

  it("treats a timeout as unreachable rather than as a bad response", async () => {
    const client = new CheckoutClient({
      baseUrl: "http://checkout.test",
      timeoutMs: 10,
      fetchImpl: ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })) as unknown as typeof fetch,
    });
    await expect(client.metrics()).rejects.toBeInstanceOf(CheckoutServiceUnreachableError);
  });
});
