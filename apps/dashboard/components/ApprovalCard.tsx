"use client";

import { useState } from "react";
import type { PendingApproval } from "@/lib/types";

interface ApprovalCardProps {
  approval: PendingApproval;
  onDecide: (decision: "allow" | "deny", reason?: string) => Promise<void>;
}

export function ApprovalCard({ approval, onDecide }: ApprovalCardProps) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const version = typeof approval.args["version"] === "string" ? approval.args["version"] : "unknown";
  const evidence =
    typeof approval.args["reason"] === "string" ? approval.args["reason"] : "No evidence supplied";

  async function decide(decision: "allow" | "deny") {
    setBusy(true);
    try {
      await onDecide(decision, reason.trim() || undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-amber-400/50 bg-amber-500/[0.07] shadow-[0_0_60px_-25px] shadow-amber-400/60">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-400/25 bg-amber-500/10 px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-70" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-400" />
          </span>
          <h2 className="text-base font-semibold tracking-tight text-amber-100">
            Holding for your approval
          </h2>
        </div>
        <span className="rounded-full bg-amber-400/15 px-3 py-1 font-mono text-xs text-amber-200">
          {approval.serverName ?? "mcp"} / {approval.toolName}
        </span>
      </header>

      <div className="grid gap-6 px-6 py-5 lg:grid-cols-[220px_1fr]">
        <div className="space-y-4">
          <Field label="Proposed action">
            <span className="text-sm text-slate-100">Roll live traffic back to</span>
            <div className="mt-1 font-mono text-2xl font-semibold text-amber-200">{version}</div>
          </Field>
          <Field label="Reversibility">
            <span className="text-sm text-rose-200">
              Irreversible. This moves real production traffic immediately.
            </span>
          </Field>
        </div>

        <div className="space-y-4">
          <Field label="Evidence gathered by Vigil">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{evidence}</p>
          </Field>
          <div>
            <label
              htmlFor="approval-note"
              className="text-[11px] font-medium uppercase tracking-wider text-slate-400"
            >
              Note for the record (optional)
            </label>
            <input
              id="approval-note"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why you are approving or denying"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-amber-400/60"
            />
          </div>
        </div>
      </div>

      <footer className="flex flex-wrap gap-3 border-t border-amber-400/25 bg-slate-950/40 px-6 py-4">
        <button
          type="button"
          disabled={busy}
          onClick={() => decide("allow")}
          className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-50"
        >
          Approve rollback
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide("deny")}
          className="rounded-lg border border-slate-600 px-5 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-rose-400/60 hover:text-rose-200 disabled:opacity-50"
        >
          Deny
        </button>
        <span className="self-center text-xs text-slate-500">
          Requested {new Date(approval.requestedAt).toLocaleTimeString()}
        </span>
      </footer>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
