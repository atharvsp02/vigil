import type { DeployList, MetricsWindow } from "./types";

export const BACKEND_URL =
  process.env.NEXT_PUBLIC_VIGIL_BACKEND_URL ?? "http://127.0.0.1:4200";

async function send<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${BACKEND_URL}${path}`, {
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
  return send("/api/fault", { version: "v1.4.0", requests: 200 });
}

export function startInvestigation(): Promise<{ incidentId: string }> {
  return send("/api/investigations", {});
}

export function decide(decision: "allow" | "deny", reason?: string): Promise<unknown> {
  return send("/api/approvals", reason ? { decision, reason } : { decision });
}

export async function fetchMetrics(): Promise<MetricsWindow> {
  const response = await fetch(`${BACKEND_URL}/api/service/metrics?window=30m`);
  if (!response.ok) {
    throw new Error(`metrics failed with ${response.status}`);
  }
  return (await response.json()) as MetricsWindow;
}

export async function fetchDeploys(): Promise<DeployList> {
  const response = await fetch(`${BACKEND_URL}/api/service/deploys`);
  if (!response.ok) {
    throw new Error(`deploys failed with ${response.status}`);
  }
  return (await response.json()) as DeployList;
}
