import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BACKEND_URL = process.env.VIGIL_BACKEND_URL ?? "http://127.0.0.1:4200";
const API_TOKEN = process.env.VIGIL_API_TOKEN ?? "";
const OPERATOR_PASSCODE = process.env.VIGIL_OPERATOR_PASSCODE ?? "";

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

async function proxy(request: NextRequest, context: RouteContext): Promise<Response> {
  if (request.method !== "GET") {
    if (!OPERATOR_PASSCODE) {
      return Response.json(
        {
          error: "operator_passcode_unset",
          message:
            "VIGIL_OPERATOR_PASSCODE is not configured, so this dashboard cannot authorize actions",
        },
        { status: 503 },
      );
    }
    if (!matches(request.headers.get("x-vigil-operator"), OPERATOR_PASSCODE)) {
      return Response.json({ error: "locked", message: "operator passcode required" }, { status: 401 });
    }
  }
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

function matches(provided: string | null, expected: string): boolean {
  const left = Buffer.from(provided ?? "");
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  return proxy(request, context);
}

export function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  return proxy(request, context);
}
