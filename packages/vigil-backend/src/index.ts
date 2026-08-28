import { CheckoutClient } from "@vigil/checkout-client";
import { buildAgentSpec } from "./agent.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { HarnessClient } from "./harness.js";
import { IncidentStore } from "./incident.js";
import { Investigation } from "./investigation.js";

const config = loadConfig();
const store = new IncidentStore();
const checkout = new CheckoutClient({
  baseUrl: config.CHECKOUT_BASE_URL,
  adminToken: config.CHECKOUT_ADMIN_TOKEN,
  timeoutMs: 120_000,
});

const investigation = new Investigation({
  client: new HarnessClient(config.HARNESS_BASE_URL),
  store,
  spec: buildAgentSpec({
    model: config.HARNESS_MODEL,
    observabilityServer: config.OBSERVABILITY_MCP_SERVER,
    deploysServer: config.DEPLOYS_MCP_SERVER,
  }),
  gatedTool: "rollback-deploy",
  timeoutMs: config.TURN_TIMEOUT_MS,
});

const app = createApp({
  store,
  investigation,
  checkout,
  dashboardOrigin: config.DASHBOARD_ORIGIN,
});

const server = app.listen(config.PORT, () => {
  process.stdout.write(
    `${JSON.stringify({ event: "listening", service: "vigil-backend", port: config.PORT })}\n`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
