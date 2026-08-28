"use client";

import type { DeployList, MetricsWindow } from "@/lib/types";

interface ServiceHealthProps {
  metrics: MetricsWindow | null;
  deploys: DeployList | null;
}

export function ServiceHealth({ metrics, deploys }: ServiceHealthProps) {
  const errorRate = metrics ? metrics.errorRate * 100 : null;
  const healthy = errorRate !== null && errorRate < 1;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
      <h2 className="text-sm font-semibold tracking-tight text-slate-200">Checkout service</h2>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Stat
          label="Error rate"
          value={errorRate === null ? "-" : `${errorRate.toFixed(1)}%`}
          tone={errorRate === null ? "flat" : healthy ? "good" : "bad"}
        />
        <Stat label="Requests" value={metrics ? String(metrics.requestCount) : "-"} tone="flat" />
        <Stat
          label="Active deploy"
          value={deploys?.active ?? "-"}
          tone={deploys?.active === "v1.4.0" ? "bad" : "good"}
        />
        <Stat label="p95 latency" value={metrics ? `${metrics.latencyP95Ms} ms` : "-"} tone="flat" />
      </div>

      {metrics && metrics.byVersion.length > 0 ? (
        <div className="mt-5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Error rate by version
          </div>
          <ul className="mt-2 space-y-2">
            {metrics.byVersion.map((version) => (
              <li key={version.version} className="flex items-center gap-3">
                <span className="w-16 shrink-0 font-mono text-xs text-slate-300">
                  {version.version}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <span
                    className={`block h-full rounded-full ${version.errorRate > 0.01 ? "bg-rose-400" : "bg-emerald-400"}`}
                    style={{ width: `${Math.max(version.errorRate * 100, 1)}%` }}
                  />
                </span>
                <span className="w-12 shrink-0 text-right font-mono text-xs text-slate-400">
                  {(version.errorRate * 100).toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {deploys ? (
        <div className="mt-5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Deploy history
          </div>
          <ul className="mt-2 space-y-1.5">
            {deploys.deploys.slice(0, 5).map((deploy) => (
              <li key={deploy.version} className="flex items-baseline gap-2 text-xs">
                <span
                  className={`font-mono ${deploy.active ? "text-emerald-300" : "text-slate-400"}`}
                >
                  {deploy.version}
                </span>
                <span className="truncate text-slate-500">{deploy.commitMessage}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "good" | "bad" | "flat" }) {
  const tones = {
    good: "text-emerald-300",
    bad: "text-rose-300",
    flat: "text-slate-200",
  } as const;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-0.5 font-mono text-lg ${tones[tone]}`}>{value}</div>
    </div>
  );
}
