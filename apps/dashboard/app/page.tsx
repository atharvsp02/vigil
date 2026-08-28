"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApprovalCard } from "@/components/ApprovalCard";
import { ServiceHealth } from "@/components/ServiceHealth";
import { StatusPill } from "@/components/StatusPill";
import { Timeline } from "@/components/Timeline";
import { API_BASE, decide, fetchDeploys, fetchMetrics, startInvestigation, triggerFault } from "@/lib/api";
import type { DeployList, IncidentSnapshot, MetricsWindow } from "@/lib/types";

const EMPTY: IncidentSnapshot = {
  incidentId: null,
  status: "idle",
  alert: null,
  sessionId: null,
  startedAt: null,
  finishedAt: null,
  sandboxId: null,
  timeline: [],
  pendingApproval: null,
  approvals: [],
  summary: null,
  error: null,
};

export default function Page() {
  const [snapshot, setSnapshot] = useState<IncidentSnapshot>(EMPTY);
  const [connected, setConnected] = useState(false);
  const [metrics, setMetrics] = useState<MetricsWindow | null>(null);
  const [deploys, setDeploys] = useState<DeployList | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const source = new EventSource(`${API_BASE}/stream`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event) => {
      setSnapshot(JSON.parse(event.data) as IncidentSnapshot);
      setConnected(true);
    };
    return () => source.close();
  }, []);

  const refreshService = useCallback(() => {
    fetchMetrics().then(setMetrics).catch(() => undefined);
    fetchDeploys().then(setDeploys).catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshService();
    const timer = setInterval(refreshService, 5000);
    return () => clearInterval(timer);
  }, [refreshService]);

  useEffect(() => {
    timelineRef.current?.scrollTo({ top: timelineRef.current.scrollHeight, behavior: "smooth" });
  }, [snapshot.timeline.length]);

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await action();
      refreshService();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  const running = snapshot.status === "investigating" || snapshot.status === "executing";

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Vigil</h1>
          <p className="mt-1 text-sm text-slate-400">
            Watches the checkout service, proves the cause, and asks before it acts
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 text-xs text-slate-500">
            <span
              className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-slate-600"}`}
            />
            {connected ? "live" : "offline"}
          </span>
          <StatusPill status={snapshot.status} />
        </div>
      </header>

      {error ? (
        <p className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-200">
          {error}
        </p>
      ) : null}

      {snapshot.pendingApproval ? (
        <div className="mt-6">
          <ApprovalCard
            approval={snapshot.pendingApproval}
            onDecide={(choice, reason) => run("decide", () => decide(choice, reason))}
          />
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/20">
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
            <h2 className="text-sm font-semibold tracking-tight text-slate-200">
              Investigation timeline
            </h2>
            {snapshot.sandboxId ? (
              <span className="font-mono text-[11px] text-cyan-300/80">sandbox attached</span>
            ) : null}
          </div>
          <div ref={timelineRef} className="scroll-thin max-h-[62vh] overflow-y-auto p-4">
            <Timeline entries={snapshot.timeline} />
          </div>
        </section>

        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
            <h2 className="text-sm font-semibold tracking-tight text-slate-200">Demo controls</h2>
            <div className="mt-4 space-y-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => run("fault", triggerFault)}
                className="w-full rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-sm font-medium text-rose-200 transition hover:bg-rose-500/20 disabled:opacity-50"
              >
                {busy === "fault" ? "Breaking checkout..." : "Break the checkout service"}
              </button>
              <button
                type="button"
                disabled={busy !== null || running || snapshot.status === "awaiting_approval"}
                onClick={() => run("investigate", startInvestigation)}
                className="w-full rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-sky-950 transition hover:bg-sky-400 disabled:opacity-50"
              >
                {running ? "Vigil is working..." : "Page Vigil"}
              </button>
            </div>
            {snapshot.alert ? (
              <p className="mt-4 rounded-lg bg-slate-950/50 px-3 py-2 text-xs leading-relaxed text-slate-400">
                {snapshot.alert}
              </p>
            ) : null}
          </section>

          <ServiceHealth metrics={metrics} deploys={deploys} />

          {snapshot.summary && !snapshot.pendingApproval ? (
            <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] p-5">
              <h2 className="text-sm font-semibold tracking-tight text-emerald-200">
                Vigil&apos;s report
              </h2>
              <p className="scroll-thin mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-300">
                {snapshot.summary}
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
