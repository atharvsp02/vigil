import { describe, expect, it } from "vitest";
import { CheckoutServiceError, CheckoutServiceUnreachableError } from "@vigil/checkout-client";
import { guard } from "../src/runtime/results.js";

describe("guard", () => {
  it("serialises a successful payload as pretty JSON", async () => {
    const result = await guard(async () => ({ errorRate: 0.34 }));
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual({ errorRate: 0.34 });
  });

  it("surfaces the upstream status and body when the service rejects the call", async () => {
    const result = await guard(async () => {
      throw new CheckoutServiceError("boom", 404, '{"error":"unknown_version"}');
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("HTTP 404");
    expect(result.content[0]?.text).toContain("unknown_version");
  });

  it("tells the agent unreachability is missing evidence, not a healthy service", async () => {
    const result = await guard(async () => {
      throw new CheckoutServiceUnreachableError("no route", new Error("ECONNREFUSED"));
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("missing evidence");
  });

  it("still reports an error for a non-Error throw", async () => {
    const result = await guard(async () => {
      throw "plain string";
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("plain string");
  });
});
