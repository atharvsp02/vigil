import { insertDeployIfAbsent, activeDeployRecord, setActiveDeploy } from "./db.js";
import type { Db } from "./db.js";
import type { DeployRecord } from "./types.js";

interface DeploySeed {
  version: string;
  commitSha: string;
  commitMessage: string;
  author: string;
  variant: string;
  minutesAgo: number;
}

const HISTORY: DeploySeed[] = [
  {
    version: "v1.0.0",
    commitSha: "3f1a9c2",
    commitMessage: "Initial checkout implementation",
    author: "priya",
    variant: "baseline-no-discounts",
    minutesAgo: 8640,
  },
  {
    version: "v1.1.0",
    commitSha: "b7d4e10",
    commitMessage: "Add discount code support",
    author: "marcus",
    variant: "discount-support",
    minutesAgo: 5760,
  },
  {
    version: "v1.2.0",
    commitSha: "9ac3f57",
    commitMessage: "Tighten cart validation for empty line items",
    author: "priya",
    variant: "discount-support",
    minutesAgo: 2880,
  },
  {
    version: "v1.3.0",
    commitSha: "1e6b8d4",
    commitMessage: "Add structured request logging",
    author: "dev",
    variant: "discount-support",
    minutesAgo: 1440,
  },
  {
    version: "v1.4.0",
    commitSha: "c52f0ab",
    commitMessage: "Optimize payment authorization path",
    author: "marcus",
    variant: "fast-authorization-path",
    minutesAgo: 45,
  },
];

export function seedDeployHistory(db: Db, now: Date = new Date()): void {
  for (const entry of HISTORY) {
    const record: DeployRecord = {
      version: entry.version,
      commit_sha: entry.commitSha,
      commit_message: entry.commitMessage,
      author: entry.author,
      deployed_at: new Date(now.getTime() - entry.minutesAgo * 60_000).toISOString(),
      variant: entry.variant,
      active: 0,
    };
    insertDeployIfAbsent(db, record);
  }
  if (!activeDeployRecord(db)) {
    const latest = HISTORY[HISTORY.length - 1];
    if (latest) {
      setActiveDeploy(db, latest.version);
    }
  }
}

export function seededVersions(): string[] {
  return HISTORY.map((entry) => entry.version);
}
