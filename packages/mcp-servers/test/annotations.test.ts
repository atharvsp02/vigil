import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CheckoutClient } from "@vigil/checkout-client";
import { registerObservabilityTools } from "../src/observability/tools.js";
import { registerDeployTools } from "../src/deploys/tools.js";

interface CapturedTool {
  name: string;
  annotations: Record<string, unknown> | undefined;
  required: string[];
}

function capture(register: (server: McpServer, client: CheckoutClient) => void): CapturedTool[] {
  const captured: CapturedTool[] = [];
  const server = {
    registerTool(name: string, config: Record<string, unknown>) {
      const input = (config["inputSchema"] ?? {}) as Record<string, { isOptional?: () => boolean }>;
      const required = Object.entries(input)
        .filter(([, schema]) => typeof schema?.isOptional === "function" && !schema.isOptional())
        .map(([key]) => key);
      captured.push({
        name,
        annotations: config["annotations"] as Record<string, unknown> | undefined,
        required,
      });
      return {};
    },
  } as unknown as McpServer;
  register(server, new CheckoutClient({ baseUrl: "http://127.0.0.1:1" }));
  return captured;
}

describe("observability tools", () => {
  const tools = capture(registerObservabilityTools);

  it("exposes exactly the read-only investigation tools", () => {
    expect(tools.map((tool) => tool.name)).toEqual([
      "query-metrics",
      "query-logs",
      "get-replay-bundle",
    ]);
  });

  it("keeps the replay bundle read-only even though it feeds code execution", () => {
    const replay = tools.find((tool) => tool.name === "get-replay-bundle");
    expect(replay?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  });

  it("marks every tool read-only and non-destructive", () => {
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
  });

  it("takes no required arguments, so evidence gathering is never blocked", () => {
    for (const tool of tools) {
      expect(tool.required).toEqual([]);
    }
  });
});

describe("deploy tools", () => {
  const tools = capture(registerDeployTools);
  const rollback = tools.find((tool) => tool.name === "rollback-deploy");
  const list = tools.find((tool) => tool.name === "list-deploys");

  it("exposes one read-only tool and one mutating tool", () => {
    expect(tools.map((tool) => tool.name)).toEqual(["list-deploys", "rollback-deploy"]);
  });

  it("keeps list-deploys read-only", () => {
    expect(list?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  });

  it("marks rollback-deploy destructive so the harness gates it by default", () => {
    expect(rollback?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });

  it("forces the agent to supply a target version and written evidence", () => {
    expect(rollback?.required.sort()).toEqual(["reason", "version"]);
  });
});
