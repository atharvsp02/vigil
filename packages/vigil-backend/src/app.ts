import express from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import type {
  ActivationResult,
  DeployList,
  LoadOptions,
  LoadResult,
  MetricsQuery,
  MetricsWindow,
} from "@vigil/checkout-client";
import type { IncidentSnapshot, IncidentStore } from "./incident.js";
import { Investigation, InvestigationConflictError } from "./investigation.js";

export const DEFAULT_ALERT =
  "PagerDuty: checkout error rate above 20 percent for 5 minutes on the payments service";

const alertSchema = z.object({
  alert: z.string().trim().min(10).max(2000).default(DEFAULT_ALERT),
});

const decisionSchema = z.object({
  decision: z.enum(["allow", "deny"]),
  reason: z.string().trim().min(1).max(500).optional(),
});

const faultSchema = z.object({
  version: z.string().trim().min(1).max(64).default("v1.4.0"),
  requests: z.coerce.number().int().positive().max(1000).default(240),
});

const metricsQuerySchema = z.object({
  window: z
    .string()
    .regex(/^\d{1,5}(m|h)$/)
    .default("30m"),
});

export interface CheckoutGateway {
  metrics(query?: MetricsQuery): Promise<MetricsWindow>;
  deploys(): Promise<DeployList>;
  activateDeploy(version: string): Promise<ActivationResult>;
  generateLoad(options?: LoadOptions): Promise<LoadResult>;
}

export interface AppOptions {
  store: IncidentStore;
  investigation: Investigation;
  checkout: CheckoutGateway;
  dashboardOrigin: string;
}

export function createApp(options: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
  app.use(cors(options.dashboardOrigin));

  const limiter = rateLimiter({ windowMs: 60_000, max: 20 });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", incident: options.store.get().status });
  });

  app.get("/api/state", (_req, res) => {
    res.json(options.store.get());
  });

  app.get("/api/stream", (req, res) => {
    streamSnapshots(req, res, options.store);
  });

  app.post("/api/investigations", limiter, async (req, res) => {
    const parsed = alertSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
      return;
    }
    try {
      const incidentId = await options.investigation.start(parsed.data.alert);
      res.status(202).json({ incidentId, status: options.store.get().status });
    } catch (error) {
      respondToFailure(res, error);
    }
  });

  app.post("/api/approvals", limiter, async (req, res) => {
    const parsed = decisionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
      return;
    }
    try {
      await options.investigation.decide(
        parsed.data.decision,
        parsed.data.reason ?? undefined,
      );
      res.status(202).json({ status: options.store.get().status });
    } catch (error) {
      respondToFailure(res, error);
    }
  });

  app.post("/api/fault", limiter, async (req, res) => {
    const parsed = faultSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
      return;
    }
    try {
      const activation = await options.checkout.activateDeploy(parsed.data.version);
      const load = await options.checkout.generateLoad({ requests: parsed.data.requests });
      res.json({ activation, load });
    } catch (error) {
      respondToFailure(res, error);
    }
  });

  app.get("/api/service/metrics", async (req, res) => {
    const parsed = metricsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
      return;
    }
    try {
      res.json(await options.checkout.metrics({ window: parsed.data.window }));
    } catch (error) {
      respondToFailure(res, error);
    }
  });

  app.get("/api/service/deploys", async (_req, res) => {
    try {
      res.json(await options.checkout.deploys());
    } catch (error) {
      respondToFailure(res, error);
    }
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  return app;
}

function streamSnapshots(req: Request, res: Response, store: IncidentStore): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const send = (snapshot: IncidentSnapshot): void => {
    res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
  };
  send(store.get());
  const unsubscribe = store.subscribe(send);
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 20_000);
  heartbeat.unref?.();
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
}

function cors(origin: string) {
  return (req: Request, res: Response, next: () => void): void => {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    res.setHeader("vary", "origin");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}

export function rateLimiter(options: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: () => void): void => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }
    entry.count += 1;
    if (entry.count > options.max) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }
    next();
  };
}

function respondToFailure(res: Response, error: unknown): void {
  if (error instanceof InvestigationConflictError) {
    res.status(409).json({ error: "conflict", message: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  res.status(502).json({ error: "upstream_failure", message });
}
