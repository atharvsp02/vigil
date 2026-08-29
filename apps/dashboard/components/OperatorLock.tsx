"use client";

import { useState } from "react";

interface OperatorLockProps {
  onUnlock: (passcode: string) => void;
}

export function OperatorLock({ onUnlock }: OperatorLockProps) {
  const [passcode, setPasscode] = useState("");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (passcode.trim()) {
          onUnlock(passcode.trim());
        }
      }}
      className="rounded-2xl border border-slate-700 bg-slate-900/60 p-5"
    >
      <h2 className="text-sm font-semibold tracking-tight text-slate-200">Operator unlock</h2>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">
        Approving a rollback moves live production traffic, so this dashboard only acts for an
        operator who holds the passcode. It is printed by <code>scripts/dev.sh</code>.
      </p>
      <input
        type="password"
        value={passcode}
        onChange={(event) => setPasscode(event.target.value)}
        placeholder="Operator passcode"
        className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-400/60"
      />
      <button
        type="submit"
        className="mt-3 w-full rounded-lg bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-white"
      >
        Unlock
      </button>
    </form>
  );
}
