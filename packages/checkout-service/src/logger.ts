import { insertLog } from "./db.js";
import type { Db } from "./db.js";
import type { LogLevel } from "./types.js";

export interface LogFields {
  requestId?: string;
  statusCode?: number;
  latencyMs?: number;
  attributes?: Record<string, unknown>;
}

export class Logger {
  constructor(
    private readonly db: Db,
    private readonly service: string,
    private readonly echoToStdout: boolean = true,
  ) {}

  log(level: LogLevel, version: string, message: string, fields: LogFields = {}): void {
    const record = {
      ts: new Date().toISOString(),
      level,
      service: this.service,
      version,
      message,
      request_id: fields.requestId ?? null,
      status_code: fields.statusCode ?? null,
      latency_ms: fields.latencyMs ?? null,
      attributes: fields.attributes ? JSON.stringify(fields.attributes) : null,
    };
    insertLog(this.db, record);
    if (this.echoToStdout) {
      process.stdout.write(`${JSON.stringify(record)}\n`);
    }
  }

  info(version: string, message: string, fields?: LogFields): void {
    this.log("info", version, message, fields);
  }

  warn(version: string, message: string, fields?: LogFields): void {
    this.log("warn", version, message, fields);
  }

  error(version: string, message: string, fields?: LogFields): void {
    this.log("error", version, message, fields);
  }
}
