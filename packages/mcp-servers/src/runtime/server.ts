import express from "express";
import { timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export interface McpHttpServerOptions {
  name: string;
  version: string;
  instructions: string;
  port: number;
  bearerToken?: string | undefined;
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
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: options.name, version: options.version });
  });

  app.post("/mcp", (req, res, next) => {
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

  app.post("/mcp", async (req, res) => {
    const server = new McpServer(
      { name: options.name, version: options.version },
      { instructions: options.instructions },
    );
    options.registerTools(server);

    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport as unknown as Transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  const httpServer = await new Promise<Server>((resolve, reject) => {
    const started = app.listen(options.port, () => resolve(started));
    started.once("error", reject);
  });

  const address = httpServer.address();
  const boundPort = address && typeof address === "object" ? address.port : options.port;

  return {
    port: boundPort,
    url: `http://127.0.0.1:${boundPort}/mcp`,
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
