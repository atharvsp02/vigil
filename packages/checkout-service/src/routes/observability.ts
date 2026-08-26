import { Router } from "express";
import { z } from "zod";
import { listDeployRecords, activeDeployRecord } from "../db.js";
import type { Db } from "../db.js";
import { computeMetrics, queryLogs } from "../metrics.js";
import type { Deploy } from "../types.js";

const WINDOW_PATTERN = /^(\d{1,5})(m|h)$/;
const MAX_WINDOW_MINUTES = 60 * 24 * 30;

const metricsQuerySchema = z
  .object({
    window: z
      .string()
      .regex(WINDOW_PATTERN)
      .refine((value) => windowMinutes(value) <= MAX_WINDOW_MINUTES, {
        message: `window must not exceed ${MAX_WINDOW_MINUTES} minutes`,
      })
      .default("30m"),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: "from must not be later than to",
    path: ["from"],
  });

const logsQuerySchema = z
  .object({
    level: z.enum(["debug", "info", "warn", "error"]).optional(),
    version: z.string().min(1).max(64).optional(),
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
    search: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().positive().max(500).default(100),
  })
  .refine((query) => !query.since || !query.until || query.since <= query.until, {
    message: "since must not be later than until",
    path: ["since"],
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

function windowMinutes(window: string): number {
  const match = WINDOW_PATTERN.exec(window);
  if (!match) {
    return Number.POSITIVE_INFINITY;
  }
  const amount = Number(match[1]);
  return match[2] === "h" ? amount * 60 : amount;
}

function shiftWindow(to: Date, window: string): string {
  const minutes = windowMinutes(window);
  const shifted = new Date(to.getTime() - minutes * 60_000);
  if (Number.isNaN(shifted.getTime())) {
    throw new RangeError(`Window ${window} resolves to an out-of-range date`);
  }
  return shifted.toISOString();
}
