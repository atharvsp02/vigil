import type { DeployList, MetricsWindow } from "./types";

export const API_BASE = "/api/vigil";

async function send<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? `${path} failed with ${response.status}`);
  }
  return payload;
}

export function triggerFault(): Promise<{ load: { failed: number; requests: number } }> {
  return send("/fault", { version: "v1.4.0", requests: 200 });
}

export function startInvestigation(): Promise<{ incidentId: string }> {
  return send("/investigations", {});
}

export function decide(decision: "allow" | "deny", reason?: string): Promise<unknown> {
  return send("/approvals", reason ? { decision, reason } : { decision });
}

async function read<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

export function fetchMetrics(): Promise<MetricsWindow> {
  return read<MetricsWindow>("/service/metrics?window=30m");
}

export function fetchDeploys(): Promise<DeployList> {
  return read<DeployList>("/service/deploys");
}
