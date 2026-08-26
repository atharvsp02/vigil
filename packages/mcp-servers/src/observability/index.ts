import { CheckoutClient } from "@vigil/checkout-client";
import { loadRuntimeConfig } from "../runtime/config.js";
import { startMcpHttpServer } from "../runtime/server.js";
import { registerObservabilityTools } from "./tools.js";

const config = loadRuntimeConfig({ PORT: "4101" });

const client = new CheckoutClient({
  baseUrl: config.CHECKOUT_BASE_URL,
  timeoutMs: config.REQUEST_TIMEOUT_MS,
});

const server = await startMcpHttpServer({
  name: "vigil-observability",
  version: "0.1.0",
  instructions:
    "Read-only access to the checkout service's metrics and logs. Nothing here changes state, so these tools are safe to call freely while gathering evidence.",
  port: config.PORT,
  bearerToken: config.MCP_BEARER_TOKEN,
  registerTools: (mcp) => registerObservabilityTools(mcp, client),
});

process.stdout.write(
  `${JSON.stringify({ event: "listening", server: "vigil-observability", url: server.url })}\n`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
