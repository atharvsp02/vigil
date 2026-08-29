# Vigil

Vigil watches a production service for problems, investigates the root cause itself, proves the culprit by replaying real traffic in a sandbox, and then stops and asks a human before it does anything irreversible.

Built for the Agent Harness Hackathon on [TrueForge](https://trueforge.dev).

## The flow

```
alert fires
  -> three subagents query metrics, logs and deploy history in parallel over MCP
  -> a replay bundle runs in a sandbox and proves which deploy broke the service
  -> Vigil proposes a rollback and the harness pauses
  -> a human approves or denies on the dashboard
  -> the rollback executes and Vigil confirms recovery
```

The pause is the point. `rollback-deploy` moves live production traffic, so it is declared destructive and the harness will not run it without a person saying yes.

## Architecture

```
  Dashboard (Next.js)          Vigil backend (Node)              TrueForge harness
  live timeline                drives one incident               agent loop, sandbox,
  approval card       ---->    at a time              <-------   approval gate, session
  service health               SSE to the browser       HTTP     state
        |                              |                                |
        | server-side proxy            | reads metrics                  | MCP tool calls
        | keeps the token              | and deploys                    v
        | out of the browser           |                    +-------------------------+
                                       |                    | vigil-observability MCP |
                                       |                    |   query-metrics         |
                                       |                    |   query-logs            |
                                       |                    |   get-replay-bundle     |
                                       |                    +-------------------------+
                                       |                    | vigil-deploys MCP       |
                                       |                    |   list-deploys          |
                                       |                    |   rollback-deploy  (!)  |
                                       |                    +-------------------------+
                                       v                                |
                             +-----------------------------+            |
                             | Checkout service (Express)  | <----------+
                             | SQLite, structured logs,    |
                             | metrics, deploy history,    |
                             | recorded request samples    |
                             +-----------------------------+

  (!) destructive, approval-gated
```

The service under investigation is a real Express and SQLite checkout API with five seeded deploys. Version `v1.4.0` fails every checkout that carries a discount code, so the incident is real traffic failing against a real fault rather than a scripted animation.

## What makes this more than a chat box

- **Real MCP tools.** Five tools across two MCP servers, each authenticated with a bearer token. Read-only tools are annotated as such, and `rollback-deploy` is annotated destructive.
- **Real sandboxed code execution.** Metrics and logs only show correlation. To prove causation, the agent pulls a replay bundle containing the deployed pricing modules and a sample of recorded requests, then runs it in a sandbox against every candidate version. The bundle never passes through the model's context, so the agent cannot fake the result by paraphrasing the code.
- **A real approval gate.** The harness suspends the turn on `tool.approval_required`. The backend surfaces the proposed version and the agent's evidence on the dashboard and resumes the session only after a human decides.
- **Real subagents.** Three investigators run in parallel and report only what their tools returned.
- **Session persistence.** The investigation lives in a harness session, so an approval arriving minutes later resumes the same session rather than starting over.

## Running it

### Prerequisites

- Node.js 22 or newer
- pnpm
- python3, used by the replay runner inside the sandbox
- A Google AI Studio API key for Gemini, on the free tier
- Optionally a Daytona API key for a hosted sandbox. TrueForge reports a local sandbox fallback when no provider is configured.

### Steps

```bash
git clone https://github.com/atharvsp02/vigil.git
cd vigil
pnpm install
bash scripts/dev.sh
```

`scripts/dev.sh` generates any missing secrets into `.env`, builds the workspace, starts the checkout service, both MCP servers, the TrueForge harness and the Vigil backend, and registers the MCP servers with the harness.

On the first run it will tell you that no model provider is configured. Open http://localhost:8790, go to Settings, add Google Gemini with your API key, and enable a model. `google-gemini/gemini-3-5-flash-lite` is the default the backend asks for. If you have a Daytona key, add it under sandbox providers in the same screen.

Then start the dashboard:

```bash
pnpm --filter @vigil/dashboard dev
```

Open http://localhost:3000.

### Watching an incident

1. Click **Break the checkout service**. This activates the faulty `v1.4.0` deploy and sends real traffic through it, so the error rate climbs to roughly a third of requests.
2. Click **Page Vigil**. The timeline fills in as the investigation happens.
3. When the approval card appears, read the evidence Vigil gathered and click **Approve rollback** or **Deny**.
4. Watch the rollback execute and the error rate fall.

A full run takes about three to four minutes on the free Gemini tier.

### Ports

| Service | URL |
| --- | --- |
| Dashboard | http://localhost:3000 |
| Vigil backend | http://127.0.0.1:4200 |
| TrueForge harness | http://localhost:8790 |
| Checkout service | http://127.0.0.1:4000 |
| Observability MCP | http://127.0.0.1:4101/mcp |
| Deploys MCP | http://127.0.0.1:4102/mcp |

Logs for every process are written to `.dev-logs/`.

## Layout

```
apps/dashboard            Next.js console: timeline, approval card, service health
packages/vigil-backend    Drives the harness, translates its event stream, holds approvals
packages/mcp-servers      The two MCP servers and their shared authenticated runtime
packages/checkout-service The service under investigation, with the seeded fault
packages/checkout-client  Typed client shared by the MCP servers and the backend
scripts/dev.sh            One command that starts and wires the whole stack
```

## Development

```bash
pnpm test        # 144 tests across the workspace
pnpm typecheck   # strict TypeScript, every package
pnpm build
```

## Safety and secrets

- Every token is generated locally into `.env`, which is git ignored, and the file is created with owner-only permissions.
- The Gemini key lives in the harness, never in this repo and never in the browser.
- The Vigil backend binds to loopback by default and requires a bearer token for anything that starts an investigation, decides an approval, or touches the checkout admin API. The dashboard holds that token server side and proxies browser calls, so it is never shipped to the client.
- The replay runner verifies the Node archive it downloads against a pinned SHA-256 digest, extracts it with traversal protection, and runs inside a temporary directory.
- `rollback-deploy` is the only write tool, and it cannot run without human approval.

## License

[MIT](LICENSE)
