export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  id: number;
  ts: string;
  level: LogLevel;
  service: string;
  version: string;
  message: string;
  request_id: string | null;
  status_code: number | null;
  latency_ms: number | null;
  attributes: string | null;
}

export interface DeployRecord {
  version: string;
  commit_sha: string;
  commit_message: string;
  author: string;
  deployed_at: string;
  variant: string;
  active: number;
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

export interface VersionMetrics {
  version: string;
  requestCount: number;
  errorCount: number;
  errorRate: number;
}

export interface CheckoutRequest {
  cartId: string;
  items: CheckoutItem[];
  discountCode?: string | undefined;
  currency: string;
}

export interface CheckoutItem {
  sku: string;
  quantity: number;
  unitPriceCents: number;
}

export interface CheckoutResult {
  orderId: string;
  subtotalCents: number;
  discountCents: number;
  payableCents: number;
  currency: string;
  authorizedAt: string;
}
