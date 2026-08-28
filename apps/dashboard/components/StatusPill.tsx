import type { IncidentStatus } from "@/lib/types";

const LABELS: Record<IncidentStatus, string> = {
  idle: "Idle",
  investigating: "Investigating",
  awaiting_approval: "Holding for approval",
  executing: "Executing rollback",
  resolved: "Resolved",
  denied: "Denied",
  failed: "Failed",
};

const STYLES: Record<IncidentStatus, string> = {
  idle: "bg-slate-800 text-slate-300 ring-slate-700",
  investigating: "bg-sky-500/10 text-sky-300 ring-sky-500/40",
  awaiting_approval: "bg-amber-500/15 text-amber-200 ring-amber-400/50",
  executing: "bg-violet-500/10 text-violet-200 ring-violet-400/40",
  resolved: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/40",
  denied: "bg-slate-700/40 text-slate-200 ring-slate-500/40",
  failed: "bg-rose-500/10 text-rose-300 ring-rose-500/40",
};

export function StatusPill({ status }: { status: IncidentStatus }) {
  const pulse = status === "investigating" || status === "executing" || status === "awaiting_approval";
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ring-1 ${STYLES[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${pulse ? "animate-pulse" : ""}`} />
      {LABELS[status]}
    </span>
  );
}
