export interface VersionMetrics {
  version: string;
  requestCount: number;
  errorCount: number;
  errorRate: number;
}

export interface MetricsWindow {
  service: string;
  from: string;
  to: string;
  requestCount: number;
  errorCount: number;
  errorRate: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  byVersion: VersionMetrics[];
}

export interface LogEntry {
  ts: string;
  level: string;
  version: string;
  message: string;
  requestId: string | null;
  statusCode: number | null;
  latencyMs: number | null;
  attributes: Record<string, unknown> | null;
}

export interface LogPage {
  count: number;
  logs: LogEntry[];
}

export interface Deploy {
  version: string;
  commitSha: string;
  commitMessage: string;
  author: string;
  deployedAt: string;
  variant: string;
  active: boolean;
}

export interface DeployList {
  active: string | null;
  deploys: Deploy[];
}

export interface ActivationResult {
  changed: boolean;
  activeVersion: string;
  previousVersion: string | null;
  variant?: string;
}

export interface HealthStatus {
  status: string;
  service: string;
  activeVersion: string | null;
}

export interface MetricsQuery {
  window?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export interface LogsQuery {
  level?: string | undefined;
  version?: string | undefined;
  since?: string | undefined;
  until?: string | undefined;
  search?: string | undefined;
  limit?: number | undefined;
}
