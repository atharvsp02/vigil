export interface HarnessToolInfo {
  type: "mcp" | "truefoundry-system";
  name: string;
  server_name?: string;
}

export interface HarnessToolCall {
  id: string;
  type?: string;
  function?: { name?: string; arguments?: string };
  tool_info?: HarnessToolInfo;
}

export interface HarnessEvent {
  type: string;
  id: string;
  created_at?: string;
  thread_id?: string | null;
  content?: unknown;
  tool_calls?: Array<HarnessToolCall | { id: string; source_event_id: string }>;
  tool_call_id?: string;
  turn_id?: string;
  sandbox_id?: string;
  title?: string;
  agent_info?: { name?: string; input?: string };
  state?: {
    status: string;
    message?: string;
    error?: string;
    required_actions?: Array<{
      type: string;
      thread_id?: string;
      tool_calls?: Array<{ id: string; source_event_id?: string }>;
    }>;
    output?: { content?: unknown } | null;
  };
  finish_reason?: string | null;
}

export type ApprovalDecision = { status: "allow" } | { status: "deny"; reason?: string };

export interface AgentSpec {
  model: { name: string };
  instructions: string;
  mcp_servers: Array<{
    name: string;
    require_approval_for_tools?: string[];
    preload?: boolean;
  }>;
  config: {
    iteration_limit: number;
    sandbox: { enabled: boolean };
    dynamic_sub_agents: { enabled: boolean };
  };
}

export interface HarnessGateway {
  createSession(spec: AgentSpec): Promise<string>;
  streamTurn(sessionId: string, input: unknown[], signal?: AbortSignal): AsyncIterable<HarnessEvent>;
  cancel?(sessionId: string): Promise<void>;
}

export class HarnessError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HarnessError";
    this.status = status;
  }
}

export class HarnessClient implements HarnessGateway {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
  }

  async createSession(spec: AgentSpec): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: { spec } }),
    });
    const body = await readJson(response);
    const id = sessionIdOf(body);
    if (!response.ok || !id) {
      throw new HarnessError(describe(body, "session creation failed"), response.status);
    }
    return id;
  }

  async *streamTurn(
    sessionId: string,
    input: unknown[],
    signal?: AbortSignal,
  ): AsyncGenerator<HarnessEvent> {
    const requestInit: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ input, stream: true }),
    };
    if (signal) {
      requestInit.signal = signal;
    }
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/v1/sessions/${encodeURIComponent(sessionId)}/turns`,
      requestInit,
    );
    if (!response.ok) {
      const body = await readJson(response);
      throw new HarnessError(describe(body, "turn creation failed"), response.status);
    }
    if (!response.body) {
      throw new HarnessError("harness returned an empty event stream", 502);
    }
    for await (const data of parseSse(response.body)) {
      const event = safeParse(data);
      if (event) {
        yield event;
      }
    }
  }

  async cancel(sessionId: string): Promise<void> {
    await this.fetchImpl(
      `${this.baseUrl}/api/v1/sessions/${encodeURIComponent(sessionId)}/cancel`,
      { method: "POST" },
    ).catch(() => undefined);
  }
}

export async function* parseSse(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) {
          yield data;
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function sessionIdOf(body: unknown): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const envelope = body as { id?: unknown; data?: { id?: unknown } };
  const id = envelope.data?.id ?? envelope.id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function safeParse(data: string): HarnessEvent | null {
  try {
    const parsed = JSON.parse(data) as HarnessEvent;
    return typeof parsed?.type === "string" ? parsed : null;
  } catch {
    return null;
  }
}

async function readJson(response: Response): Promise<unknown> {
  return response
    .json()
    .catch(() => ({ error: { message: `harness returned status ${response.status}` } }));
}

function describe(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error: unknown }).error;
    if (error && typeof error === "object" && "message" in error) {
      return String((error as { message: unknown }).message);
    }
    return String(error);
  }
  return fallback;
}
