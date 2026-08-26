import { CheckoutClient } from "@vigil/checkout-client";
import { loadRuntimeConfig } from "../runtime/config.js";
import { startMcpHttpServer } from "../runtime/server.js";
import { registerDeployTools } from "./tools.js";

const config = loadRuntimeConfig({ PORT: "4102" });

if (!config.CHECKOUT_ADMIN_TOKEN) {
  throw new Error("CHECKOUT_ADMIN_TOKEN is required: rollback-deploy cannot work without it");
}

const client = new CheckoutClient({
  baseUrl: config.CHECKOUT_BASE_URL,
  adminToken: config.CHECKOUT_ADMIN_TOKEN,
  timeoutMs: config.REQUEST_TIMEOUT_MS,
});

const server = await startMcpHttpServer({
  name: "vigil-deploys",
  version: "0.1.0",
  instructions:
    "Deploy history and rollback for the checkout service. list-deploys is read-only. rollback-deploy changes which version serves live traffic and is gated on human approval by the harness.",
  port: config.PORT,
  bearerToken: config.MCP_BEARER_TOKEN,
  registerTools: (mcp) => registerDeployTools(mcp, client),
});

process.stdout.write(
  `${JSON.stringify({ event: "listening", server: "vigil-deploys", url: server.url })}\n`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
