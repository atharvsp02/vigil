import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DeployRecord, LogRecord } from "./types.js";

export type Db = Database.Database;

export function openDatabase(path: string): Db {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS deploys (
      version TEXT PRIMARY KEY,
      commit_sha TEXT NOT NULL,
      commit_message TEXT NOT NULL,
      author TEXT NOT NULL,
      deployed_at TEXT NOT NULL,
      variant TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      level TEXT NOT NULL,
      service TEXT NOT NULL,
      version TEXT NOT NULL,
      message TEXT NOT NULL,
      request_id TEXT,
      status_code INTEGER,
      latency_ms INTEGER,
      attributes TEXT
    );

    CREATE TABLE IF NOT EXISTS request_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      version TEXT NOT NULL,
      payload TEXT NOT NULL,
      status_code INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_samples_ts ON request_samples (ts);
    CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs (ts);
    CREATE INDEX IF NOT EXISTS idx_logs_level_ts ON logs (level, ts);
    CREATE INDEX IF NOT EXISTS idx_logs_version_ts ON logs (version, ts);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_deploys_active
      ON deploys (active) WHERE active = 1;
  `);
}

export function insertLog(
  db: Db,
  record: Omit<LogRecord, "id">,
): void {
  db.prepare(
    `INSERT INTO logs (ts, level, service, version, message, request_id, status_code, latency_ms, attributes)
     VALUES (@ts, @level, @service, @version, @message, @request_id, @status_code, @latency_ms, @attributes)`,
  ).run(record);
}

export function pruneLogs(db: Db, olderThanIso: string): number {
  const result = db.prepare(`DELETE FROM logs WHERE ts < ?`).run(olderThanIso);
  return result.changes;
}

export function listDeployRecords(db: Db): DeployRecord[] {
  return db
    .prepare(`SELECT * FROM deploys ORDER BY deployed_at DESC`)
    .all() as DeployRecord[];
}

export function findDeployRecord(db: Db, version: string): DeployRecord | undefined {
  return db.prepare(`SELECT * FROM deploys WHERE version = ?`).get(version) as
    | DeployRecord
    | undefined;
}

export function activeDeployRecord(db: Db): DeployRecord | undefined {
  return db.prepare(`SELECT * FROM deploys WHERE active = 1`).get() as
    | DeployRecord
    | undefined;
}

export function setActiveDeploy(db: Db, version: string): void {
  const activate = db.transaction((target: string) => {
    db.prepare(`UPDATE deploys SET active = 0 WHERE active = 1`).run();
    const result = db.prepare(`UPDATE deploys SET active = 1 WHERE version = ?`).run(target);
    if (result.changes === 0) {
      throw new Error(`Unknown deploy version: ${target}`);
    }
  });
  activate(version);
}

export function insertDeployIfAbsent(db: Db, record: DeployRecord): boolean {
  const result = db
    .prepare(
      `INSERT INTO deploys (version, commit_sha, commit_message, author, deployed_at, variant, active)
       VALUES (@version, @commit_sha, @commit_message, @author, @deployed_at, @variant, @active)
       ON CONFLICT (version) DO NOTHING`,
    )
    .run(record);
  return result.changes > 0;
}

export interface RequestSample {
  id: number;
  ts: string;
  version: string;
  payload: string;
  status_code: number;
}

export function recordRequestSample(
  db: Db,
  sample: Omit<RequestSample, "id">,
  retain: number,
): void {
  db.prepare(
    `INSERT INTO request_samples (ts, version, payload, status_code)
     VALUES (@ts, @version, @payload, @status_code)`,
  ).run(sample);
  db.prepare(
    `DELETE FROM request_samples
     WHERE id <= (SELECT MAX(id) - ? FROM request_samples)`,
  ).run(retain);
}

export function listRequestSamples(db: Db, limit: number): RequestSample[] {
  return db
    .prepare(`SELECT * FROM request_samples ORDER BY id DESC LIMIT ?`)
    .all(limit) as RequestSample[];
}
