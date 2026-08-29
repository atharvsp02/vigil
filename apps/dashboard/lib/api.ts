import type { DeployList, MetricsWindow } from "./types";

export const API_BASE = "/api/vigil";

const PASSCODE_KEY = "vigil.operator";

export class LockedError extends Error {
  constructor() {
    super("This dashboard is locked. Enter the operator passcode to act on the incident.");
    this.name = "LockedError";
  }
}

export function readPasscode(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.sessionStorage.getItem(PASSCODE_KEY) ?? "";
}

export function storePasscode(passcode: string): void {
  window.sessionStorage.setItem(PASSCODE_KEY, passcode);
}

export function clearPasscode(): void {
  window.sessionStorage.removeItem(PASSCODE_KEY);
}

async function send<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-vigil-operator": readPasscode() },
    body: JSON.stringify(body),
  });
  if (response.status === 401) {
    clearPasscode();
    throw new LockedError();
  }
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
