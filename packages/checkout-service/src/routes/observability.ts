import { Router } from "express";
import { z } from "zod";
import { listDeployRecords, activeDeployRecord } from "../db.js";
import type { Db } from "../db.js";
import { computeMetrics, queryLogs } from "../metrics.js";
import type { Deploy } from "../types.js";

const WINDOW_PATTERN = /^(\d+)(m|h)$/;

const metricsQuerySchema = z.object({
  window: z.string().regex(WINDOW_PATTERN).default("30m"),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const logsQuerySchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).optional(),
  version: z.string().min(1).optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  search: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

export function observabilityRouter(db: Db, service: string): Router {
  const router = Router();

  router.get("/metrics", (req, res) => {
    const parsed = metricsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_query", issues: parsed.error.issues });
      return;
    }
    const now = new Date();
    const to = parsed.data.to ?? now.toISOString();
    const from = parsed.data.from ?? shiftWindow(new Date(to), parsed.data.window);
    res.json(computeMetrics(db, service, from, to));
  });

  router.get("/logs", (req, res) => {
    const parsed = logsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_query", issues: parsed.error.issues });
      return;
    }
    const rows = queryLogs(db, { service, ...parsed.data });
    res.json({
      count: rows.length,
      logs: rows.map((row) => ({
        ts: row.ts,
        level: row.level,
        version: row.version,
        message: row.message,
        requestId: row.request_id,
        statusCode: row.status_code,
        latencyMs: row.latency_ms,
        attributes: row.attributes ? JSON.parse(row.attributes) : null,
      })),
    });
  });

  router.get("/deploys", (_req, res) => {
    const deploys: Deploy[] = listDeployRecords(db).map((row) => ({
      version: row.version,
      commitSha: row.commit_sha,
      commitMessage: row.commit_message,
      author: row.author,
      deployedAt: row.deployed_at,
      variant: row.variant,
      active: row.active === 1,
    }));
    res.json({ active: deploys.find((deploy) => deploy.active)?.version ?? null, deploys });
  });

  router.get("/health", (_req, res) => {
    const active = activeDeployRecord(db);
    res.json({ status: "ok", service, activeVersion: active?.version ?? null });
  });

  return router;
}

function shiftWindow(to: Date, window: string): string {
  const match = WINDOW_PATTERN.exec(window);
  if (!match) {
    throw new Error(`Invalid window: ${window}`);
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const minutes = unit === "h" ? amount * 60 : amount;
  return new Date(to.getTime() - minutes * 60_000).toISOString();
}
