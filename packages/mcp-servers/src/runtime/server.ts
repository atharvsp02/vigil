import { timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";
import type { ErrorRequestHandler } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export interface McpHttpServerOptions {
  name: string;
  version: string;
  instructions: string;
  port: number;
  host: string;
  bearerToken?: string | undefined;
  requireAuth?: boolean | undefined;
  registerTools: (server: McpServer) => void;
}

export interface RunningMcpServer {
  port: number;
  url: string;
  close: () => Promise<void>;
}

export async function startMcpHttpServer(
  options: McpHttpServerOptions,
): Promise<RunningMcpServer> {
  if (options.requireAuth && !options.bearerToken) {
    throw new Error(
      `${options.name} holds write credentials and refuses to start without MCP_BEARER_TOKEN`,
    );
  }
  const app = createMcpExpressApp({ host: options.host });
  app.disable("x-powered-by");

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: options.name, version: options.version });
  });

  app.post("/mcp", (req, res, next) => {
    const origin = req.header("origin");
    if (origin && !isAllowedOrigin(origin, options.host)) {
      res.status(403).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Invalid Origin" },
        id: null,
      });
      return;
    }
    if (!options.bearerToken) {
      next();
      return;
    }
    const header = req.header("authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!constantTimeEqual(presented, options.bearerToken)) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      });
      return;
    }
    next();
  });

  app.post("/mcp", async (req, res, next) => {
    const server = new McpServer(
      { name: options.name, version: options.version },
      { instructions: options.instructions },
    );
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    let closed = false;
    const closeResources = async (): Promise<void> => {
      if (closed) {
        return;
      }
      closed = true;
      await Promise.allSettled([transport.close(), server.close()]);
    };

    res.on("close", () => {
      void closeResources();
    });

    try {
      options.registerTools(server);
      await server.connect(transport as unknown as Transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      await closeResources();
      next(error);
    }
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    res.status(500).json({
      jsonrpc: "2.0",
      error: { code: -32603, message: "Internal error" },
      id: null,
    });
  };
  app.use(errorHandler);

  const httpServer = await new Promise<Server>((resolve, reject) => {
    const started = app.listen(options.port, options.host, () => resolve(started));
    started.once("error", reject);
  });

  const address = httpServer.address();
  const boundPort = address && typeof address === "object" ? address.port : options.port;

  return {
    port: boundPort,
    url: `http://${options.host}:${boundPort}/mcp`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function isAllowedOrigin(value: string, host: string): boolean {
  try {
    const origin = new URL(value);
    if (origin.protocol !== "http:" && origin.protocol !== "https:") {
      return false;
    }
    if (["127.0.0.1", "localhost", "::1"].includes(host)) {
      return ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname);
    }
    return origin.hostname === host;
  } catch {
    return false;
  }
}
