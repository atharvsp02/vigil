import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CheckoutClient } from "@vigil/checkout-client";
import { guard } from "../runtime/results.js";

export function registerDeployTools(server: McpServer, client: CheckoutClient): void {
  server.registerTool(
    "list-deploys",
    {
      title: "List checkout deploys",
      description:
        "Deploy history for the checkout service, newest first, including which version is currently serving traffic. Commit messages describe intent and are not evidence of correctness.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => guard(() => client.deploys()),
  );

  server.registerTool(
    "rollback-deploy",
    {
      title: "Roll back the checkout service to a previous deploy",
      description:
        "Changes which version of the checkout service serves live production traffic. This takes effect immediately and affects real requests. Call it only after evidence identifies a specific bad version and a specific known-good target, and state that evidence in the reason argument.",
      inputSchema: {
        version: z
          .string()
          .trim()
          .min(1)
          .describe("The known-good version to activate, exactly as reported by list-deploys."),
        reason: z
          .string()
          .trim()
          .min(20)
          .describe(
            "The evidence justifying this rollback: the failing version, the observed error rate, and why this target is believed good. Shown to the human reviewing the request.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) =>
      guard(async () => {
        const result = await client.activateDeploy(args.version);
        return { ...result, reason: args.reason };
      }),
  );
}
