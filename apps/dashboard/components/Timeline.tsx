"use client";

import { useState } from "react";
import type { EntryKind, TimelineEntry } from "@/lib/types";

const KIND_LABEL: Record<EntryKind, string> = {
  alert: "Alert",
  agent: "Reasoning",
  tool: "Tool call",
  subagent: "Subagent",
  sandbox: "Sandbox",
  approval: "Approval gate",
  decision: "Human decision",
  status: "Status",
};

const KIND_ACCENT: Record<EntryKind, string> = {
  alert: "border-rose-500/60 bg-rose-500/10 text-rose-300",
  agent: "border-slate-600 bg-slate-800/60 text-slate-300",
  tool: "border-sky-500/50 bg-sky-500/10 text-sky-300",
  subagent: "border-violet-500/50 bg-violet-500/10 text-violet-300",
  sandbox: "border-cyan-500/50 bg-cyan-500/10 text-cyan-300",
  approval: "border-amber-400/60 bg-amber-400/10 text-amber-200",
  decision: "border-emerald-500/50 bg-emerald-500/10 text-emerald-300",
  status: "border-slate-600 bg-slate-800/60 text-slate-400",
};

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800 px-6 py-16 text-center text-sm text-slate-500">
        No incident yet. Break the checkout service to watch Vigil work.
      </div>
    );
  }
  return (
    <ol className="space-y-2">
      {entries.map((entry) => (
        <TimelineItem key={entry.id} entry={entry} />
      ))}
    </ol>
  );
}

function TimelineItem({ entry }: { entry: TimelineEntry }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(entry.detail || entry.result || entry.args);
  const subagent = entry.threadId !== "main";

  return (
    <li className="rounded-xl border border-slate-800/80 bg-slate-900/40">
      <button
        type="button"
        onClick={() => expandable && setOpen(!open)}
        className={`flex w-full items-start gap-3 px-4 py-3 text-left ${expandable ? "cursor-pointer" : "cursor-default"}`}
      >
        <span
          className={`mt-0.5 shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${KIND_ACCENT[entry.kind]}`}
        >
          {KIND_LABEL[entry.kind]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium text-slate-100">{entry.title}</span>
            {entry.state ? <StateDot state={entry.state} /> : null}
            {entry.gated ? (
              <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
                gated
              </span>
            ) : null}
            {subagent ? (
              <span className="rounded bg-violet-500/10 px-1.5 py-0.5 font-mono text-[10px] text-violet-300">
                {entry.threadId.slice(0, 8)}
              </span>
            ) : null}
          </span>
          {entry.detail && !open ? (
            <span className="mt-1 block truncate text-xs text-slate-400">{entry.detail}</span>
          ) : null}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-slate-600">
          {new Date(entry.at).toLocaleTimeString()}
        </span>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-slate-800/80 px-4 py-3">
          {entry.detail ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{entry.detail}</p>
          ) : null}
          {entry.args && Object.keys(entry.args as object).length > 0 ? (
            <Block label="Arguments" body={JSON.stringify(entry.args, null, 2)} />
          ) : null}
          {entry.result ? <Block label="Result" body={entry.result} /> : null}
        </div>
      ) : null}
    </li>
  );
}

function StateDot({ state }: { state: "running" | "ok" | "error" }) {
  const styles = {
    running: "bg-sky-400 animate-pulse",
    ok: "bg-emerald-400",
    error: "bg-rose-400",
  } as const;
  return <span className={`h-1.5 w-1.5 rounded-full ${styles[state]}`} title={state} />;
}

function Block({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <pre className="scroll-thin mt-1 max-h-64 overflow-auto rounded-lg bg-slate-950/70 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
        {body}
      </pre>
    </div>
  );
}
