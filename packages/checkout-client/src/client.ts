import {
  CheckoutServiceError,
  CheckoutServiceInvalidResponseError,
  CheckoutServiceUnreachableError,
} from "./errors.js";
import type {
  ActivationResult,
  DeployList,
  HealthStatus,
  LogPage,
  LogsQuery,
  MetricsQuery,
  MetricsWindow,
  ReplayBundle,
} from "./types.js";

export interface CheckoutClientOptions {
  baseUrl: string;
  adminToken?: string | undefined;
  replayToken?: string | undefined;
  timeoutMs?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export class CheckoutClient {
  private readonly baseUrl: string;
  private readonly adminToken: string | undefined;
  private readonly replayToken: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CheckoutClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.adminToken = options.adminToken;
    this.replayToken = options.replayToken;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async health(): Promise<HealthStatus> {
    return this.request<HealthStatus>("GET", "/health");
  }

  async metrics(query: MetricsQuery = {}): Promise<MetricsWindow> {
    return this.request<MetricsWindow>("GET", `/metrics${toSearchParams(query)}`);
  }

  async logs(query: LogsQuery = {}): Promise<LogPage> {
    return this.request<LogPage>("GET", `/logs${toSearchParams(query)}`);
  }

  async replayBundle(samples?: number): Promise<ReplayBundle> {
    if (!this.replayToken) {
      throw new Error("replayBundle requires a replayToken");
    }
    const query = samples === undefined ? {} : { samples };
    return this.request<ReplayBundle>("GET", `/replay-bundle${toSearchParams(query)}`, {
      "x-replay-token": this.replayToken,
    });
  }

  async deploys(): Promise<DeployList> {
    return this.request<DeployList>("GET", "/deploys");
  }

  async activateDeploy(version: string): Promise<ActivationResult> {
    if (!this.adminToken) {
      throw new Error("activateDeploy requires an adminToken");
    }
    return this.request<ActivationResult>(
      "POST",
      `/admin/deploys/${encodeURIComponent(version)}/activate`,
      { "x-admin-token": this.adminToken },
    );
  }

  private async request<T>(
    method: string,
    path: string,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new CheckoutServiceError(
          `${method} ${path} failed with ${response.status}`,
          response.status,
          text,
        );
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new CheckoutServiceInvalidResponseError(
          `${method} ${path} returned HTTP ${response.status} with a body that is not valid JSON`,
          response.status,
          text.slice(0, 500),
        );
      }
    } catch (error) {
      if (
        error instanceof CheckoutServiceError ||
        error instanceof CheckoutServiceInvalidResponseError
      ) {
        throw error;
      }
      throw new CheckoutServiceUnreachableError(
        `${method} ${path} could not reach the checkout service at ${this.baseUrl}`,
        error,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

function toSearchParams(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}
