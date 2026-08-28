import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { openDatabase, recordRequestSample } from "../src/db.js";
import type { Db } from "../src/db.js";
import { buildReplayBundle } from "../src/replay.js";
import { seedDeployHistory } from "../src/seed.js";

const run = promisify(execFile);

let db: Db;

beforeEach(() => {
  db = openDatabase(":memory:");
  seedDeployHistory(db);
});

afterEach(() => {
  db.close();
});

function sample(discountCode: string | undefined, status: number): void {
  const request = {
    cartId: `cart_${Math.random().toString(36).slice(2, 8)}`,
    currency: "USD",
    items: [{ sku: "A", quantity: 2, unitPriceCents: 1500 }],
    ...(discountCode ? { discountCode } : {}),
  };
  recordRequestSample(
    db,
    {
      ts: new Date().toISOString(),
      version: "v1.4.0",
      payload: JSON.stringify(request),
      status_code: status,
    },
    500,
  );
}

describe("replay bundle", () => {
  it("ships the real deployed modules rather than a copy", async () => {
    const bundle = await buildReplayBundle(db, 10);
    expect(Object.keys(bundle.modules).sort()).toEqual(["pricing.js", "variants.js"]);
    expect(bundle.modules["variants.js"]).toContain("fast-authorization-path");
    expect(bundle.modules["pricing.js"]).toContain("subtotalCents");
  });

  it("strips source map comments so the sandbox can import the modules", async () => {
    const bundle = await buildReplayBundle(db, 10);
    for (const source of Object.values(bundle.modules)) {
      expect(source).not.toContain("sourceMappingURL");
    }
  });

  it("orders candidates oldest first so the first failure is the culprit", async () => {
    const bundle = await buildReplayBundle(db, 10);
    expect(bundle.candidates.map((c) => c.version)).toEqual([
      "v1.0.0",
      "v1.1.0",
      "v1.2.0",
      "v1.3.0",
      "v1.4.0",
    ]);
  });

  it("carries a runner and explicit instructions so the agent need not improvise", async () => {
    const bundle = await buildReplayBundle(db, 10);
    expect(bundle.runner).toContain("nodejs.org");
    expect(bundle.runner).toContain("tar.gz");
    expect(bundle.runner).not.toContain("tar.xz");
    expect(bundle.runner).toContain(
      "4f862bab52039835efbe613b532238b6e4dde98d139a34e6923193e073438b13",
    );
    expect(bundle.runner).toContain('filter="data"');
    expect(bundle.runner).toContain("TemporaryDirectory");
    expect(bundle.howToRun).toContain("python3 runner.py BUNDLE");
  });

  it("respects the sample limit", async () => {
    for (let i = 0; i < 12; i += 1) {
      sample(i % 2 === 0 ? "SAVE10" : undefined, i % 2 === 0 ? 500 : 200);
    }
    const bundle = await buildReplayBundle(db, 5);
    expect(bundle.samples).toHaveLength(5);
  });

  it("returns no samples before any traffic has been recorded", async () => {
    const bundle = await buildReplayBundle(db, 40);
    expect(bundle.samples).toEqual([]);
  });
});

describe("bisection harness", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "vigil-replay-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  async function bisect(): Promise<{
    status: "complete" | "inconclusive_no_samples";
    results: Array<{ version: string; failed: number; errorRate: number }>;
    firstBadVersion: string | null;
    lastGoodVersion: string | null;
  }> {
    const bundle = await buildReplayBundle(db, 40);
    await writeFile(join(workdir, "bundle.json"), JSON.stringify(bundle));
    await writeFile(join(workdir, "harness.mjs"), bundle.harness);
    const { stdout } = await run(process.execPath, ["harness.mjs", "bundle.json"], {
      cwd: workdir,
    });
    return JSON.parse(stdout);
  }

  it("identifies the culprit deploy and the last good one", async () => {
    for (let i = 0; i < 10; i += 1) {
      sample("SAVE10", 500);
      sample(undefined, 200);
    }
    const report = await bisect();
    expect(report.status).toBe("complete");
    expect(report.firstBadVersion).toBe("v1.4.0");
    expect(report.lastGoodVersion).toBe("v1.3.0");
  });

  it("clears every version that predates the fault", async () => {
    for (let i = 0; i < 6; i += 1) {
      sample("SAVE20", 500);
    }
    const report = await bisect();
    const clean = report.results.filter((r) => r.failed === 0).map((r) => r.version);
    expect(clean).toEqual(["v1.0.0", "v1.1.0", "v1.2.0", "v1.3.0"]);
  });

  it("blames nothing when the recorded traffic never triggers the fault", async () => {
    for (let i = 0; i < 8; i += 1) {
      sample(undefined, 200);
    }
    const report = await bisect();
    expect(report.firstBadVersion).toBeNull();
    expect(report.results.every((r) => r.failed === 0)).toBe(true);
  });

  it("is inconclusive when no requests were replayed", async () => {
    const report = await bisect();
    expect(report.status).toBe("inconclusive_no_samples");
    expect(report.firstBadVersion).toBeNull();
    expect(report.lastGoodVersion).toBeNull();
    expect(report.results.every((result) => result.failed === 0)).toBe(true);
  });

  it("runs without overwriting files in the caller's directory", async () => {
    const bundle = await buildReplayBundle(db, 40);
    await writeFile(join(workdir, "bundle.json"), JSON.stringify(bundle));
    await writeFile(join(workdir, "runner.py"), bundle.runner);
    await writeFile(join(workdir, "harness.mjs"), "keep");
    const { stdout } = await run("python3", ["runner.py", "bundle.json"], { cwd: workdir });
    expect(JSON.parse(stdout)).toMatchObject({ status: "inconclusive_no_samples" });
    await expect(readFile(join(workdir, "harness.mjs"), "utf8")).resolves.toBe("keep");
  });

  it("reports the failure signature alongside the culprit", async () => {
    for (let i = 0; i < 5; i += 1) {
      sample("WELCOME5", 500);
    }
    const bundle = await buildReplayBundle(db, 40);
    await writeFile(join(workdir, "bundle.json"), JSON.stringify(bundle));
    await writeFile(join(workdir, "harness.mjs"), bundle.harness);
    const { stdout } = await run(process.execPath, ["harness.mjs", "bundle.json"], {
      cwd: workdir,
    });
    const report = JSON.parse(stdout) as {
      results: Array<{ version: string; failureModes: Array<{ message: string; count: number }> }>;
    };
    const culprit = report.results.find((r) => r.version === "v1.4.0");
    expect(culprit?.failureModes[0]?.message).toContain("toFixed");
    expect(culprit?.failureModes[0]?.count).toBe(5);
  });
});
