export type IncidentStatus =
  | "idle"
  | "investigating"
  | "awaiting_approval"
  | "executing"
  | "resolved"
  | "denied"
  | "failed";

export type EntryKind =
  | "alert"
  | "agent"
  | "tool"
  | "subagent"
  | "sandbox"
  | "approval"
  | "decision"
  | "status";

export type EntryState = "running" | "ok" | "error";

export interface TimelineEntry {
  id: string;
  at: string;
  kind: EntryKind;
  threadId: string;
  title: string;
  detail?: string;
  toolName?: string;
  toolCallId?: string;
  serverName?: string;
  args?: unknown;
  result?: string;
  state?: EntryState;
  gated?: boolean;
}

export interface PendingApproval {
  toolCallId: string;
  threadId: string;
  toolName: string;
  serverName?: string;
  args: Record<string, unknown>;
  requestedAt: string;
}

export interface ApprovalOutcome {
  decision: "allow" | "deny";
  toolCallId: string;
  toolName: string;
  reason?: string;
  decidedAt: string;
}

export interface IncidentSnapshot {
  incidentId: string | null;
  status: IncidentStatus;
  alert: string | null;
  sessionId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  sandboxId: string | null;
  timeline: TimelineEntry[];
  pendingApproval: PendingApproval | null;
  approvals: ApprovalOutcome[];
  summary: string | null;
  error: string | null;
}

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
  latencyP50Ms: number;
  latencyP95Ms: number;
  byVersion: VersionMetrics[];
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
