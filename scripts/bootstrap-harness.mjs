const harnessBaseUrl = (process.env.HARNESS_BASE_URL ?? "http://127.0.0.1:8790").replace(/\/+$/, "");
const bearerToken = process.env.MCP_BEARER_TOKEN;
const observabilityPort = process.env.OBSERVABILITY_PORT ?? "4101";
const deploysPort = process.env.DEPLOYS_PORT ?? "4102";

if (!bearerToken) {
  fail("MCP_BEARER_TOKEN is not set, so the harness cannot authenticate to the MCP servers");
}

const servers = [
  {
    name: "vigil-observability",
    url: `http://127.0.0.1:${observabilityPort}/mcp`,
    description:
      "Read-only metrics, logs and replay bundles for the checkout service under investigation.",
  },
  {
    name: "vigil-deploys",
    url: `http://127.0.0.1:${deploysPort}/mcp`,
    description:
      "Deploy history for the checkout service, plus the rollback that changes which version serves live traffic.",
  },
];

const existing = await listServers();

for (const server of servers) {
  const manifest = {
    type: "remote",
    name: server.name,
    url: server.url,
    description: server.description,
    auth: { type: "header", headers: { authorization: `Bearer ${bearerToken}` } },
  };
  const method = existing.has(server.name) ? "PUT" : "POST";
  const response = await fetch(`${harnessBaseUrl}/api/v1/settings/mcp-servers`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ manifest }),
  });
  if (!response.ok) {
    fail(`${method} ${server.name} failed with ${response.status}: ${await response.text()}`);
  }
  console.log(`  ${server.name} ${method === "PUT" ? "updated" : "registered"}`);
}

const providers = await countModelProviders();
if (providers === 0) {
  console.log(
    "  no model provider configured yet; add one at " +
      `${harnessBaseUrl} under Settings, Model providers`,
  );
}

async function listServers() {
  const response = await fetch(`${harnessBaseUrl}/api/v1/settings/mcp-servers`).catch(() => null);
  if (!response) {
    fail(`the harness is not reachable at ${harnessBaseUrl}`);
  }
  if (!response.ok) {
    fail(`listing MCP servers failed with ${response.status}`);
  }
  const body = await response.json();
  return new Set((body.data ?? []).map((entry) => entry.name));
}

async function countModelProviders() {
  const response = await fetch(`${harnessBaseUrl}/api/v1/settings/model-providers`).catch(() => null);
  if (!response?.ok) {
    return 0;
  }
  const body = await response.json();
  return (body.data ?? []).length;
}

function fail(message) {
  console.error(`bootstrap-harness: ${message}`);
  process.exit(1);
}
