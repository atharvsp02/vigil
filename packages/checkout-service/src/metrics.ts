import type { Db } from "./db.js";
import type { LogRecord, MetricsWindow, VersionMetrics } from "./types.js";

interface WindowRow {
  request_count: number;
  error_count: number;
}

interface VersionRow {
  version: string;
  request_count: number;
  error_count: number;
}

export function computeMetrics(
  db: Db,
  service: string,
  fromIso: string,
  toIso: string,
): MetricsWindow {
  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS request_count,
         SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END) AS error_count
       FROM logs
       WHERE service = ? AND ts >= ? AND ts <= ? AND status_code IS NOT NULL`,
    )
    .get(service, fromIso, toIso) as WindowRow | undefined;

  const requestCount = totals?.request_count ?? 0;
  const errorCount = totals?.error_count ?? 0;

  const latencies = db
    .prepare(
      `SELECT latency_ms FROM logs
       WHERE service = ? AND ts >= ? AND ts <= ? AND latency_ms IS NOT NULL
       ORDER BY latency_ms ASC`,
    )
    .all(service, fromIso, toIso) as Array<{ latency_ms: number }>;

  const versionRows = db
    .prepare(
      `SELECT
         version,
         COUNT(*) AS request_count,
         SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END) AS error_count
       FROM logs
       WHERE service = ? AND ts >= ? AND ts <= ? AND status_code IS NOT NULL
       GROUP BY version
       ORDER BY version ASC`,
    )
    .all(service, fromIso, toIso) as VersionRow[];

  const byVersion: VersionMetrics[] = versionRows.map((row) => ({
    version: row.version,
    requestCount: row.request_count,
    errorCount: row.error_count,
    errorRate: rate(row.error_count, row.request_count),
  }));

  return {
    service,
    from: fromIso,
    to: toIso,
    requestCount,
    errorCount,
    errorRate: rate(errorCount, requestCount),
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    byVersion,
  };
}

function rate(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return Number((numerator / denominator).toFixed(4));
}

function percentile(rows: Array<{ latency_ms: number }>, fraction: number): number | null {
  if (rows.length === 0) {
    return null;
  }
  const index = Math.min(rows.length - 1, Math.floor(fraction * rows.length));
  return rows[index]?.latency_ms ?? null;
}

export interface LogQuery {
  service: string;
  level?: string | undefined;
  version?: string | undefined;
  since?: string | undefined;
  until?: string | undefined;
  search?: string | undefined;
  limit: number;
}

export function queryLogs(db: Db, query: LogQuery): LogRecord[] {
  const clauses = ["service = @service"];
  if (query.level) {
    clauses.push("level = @level");
  }
  if (query.version) {
    clauses.push("version = @version");
  }
  if (query.since) {
    clauses.push("ts >= @since");
  }
  if (query.until) {
    clauses.push("ts <= @until");
  }
  if (query.search) {
    clauses.push("message LIKE @searchPattern");
  }
  const sql = `SELECT * FROM logs WHERE ${clauses.join(" AND ")} ORDER BY ts DESC, id DESC LIMIT @limit`;
  return db.prepare(sql).all({
    service: query.service,
    level: query.level ?? null,
    version: query.version ?? null,
    since: query.since ?? null,
    until: query.until ?? null,
    searchPattern: query.search ? `%${query.search}%` : null,
    limit: query.limit,
  }) as LogRecord[];
}
