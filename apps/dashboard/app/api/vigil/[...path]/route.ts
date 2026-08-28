import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BACKEND_URL = process.env.VIGIL_BACKEND_URL ?? "http://127.0.0.1:4200";
const API_TOKEN = process.env.VIGIL_API_TOKEN ?? "";

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

async function proxy(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  const target = `${BACKEND_URL}/api/${path.join("/")}${new URL(request.url).search}`;
  const headers: Record<string, string> = { accept: request.headers.get("accept") ?? "*/*" };
  if (API_TOKEN) {
    headers["authorization"] = `Bearer ${API_TOKEN}`;
  }
  const init: RequestInit = { method: request.method, headers, signal: request.signal };
  if (request.method !== "GET") {
    headers["content-type"] = "application/json";
    init.body = await request.text();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (error) {
    return Response.json(
      { error: "backend_unreachable", message: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "application/json";
  if (contentType.includes("text/event-stream")) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  }
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": contentType },
  });
}

export function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  return proxy(request, context);
}

export function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  return proxy(request, context);
}
