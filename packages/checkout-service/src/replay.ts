import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listDeployRecords, listRequestSamples } from "./db.js";
import type { Db } from "./db.js";

export interface ReplaySample {
  ts: string;
  observedVersion: string;
  observedStatus: number;
  request: unknown;
}

export interface ReplayCandidate {
  version: string;
  variant: string;
  commitSha: string;
  commitMessage: string;
  deployedAt: string;
  active: boolean;
}

export interface ReplayBundle {
  generatedAt: string;
  entryModule: string;
  modules: Record<string, string>;
  candidates: ReplayCandidate[];
  samples: ReplaySample[];
  harness: string;
  runner: string;
  howToRun: string;
}

const MODULE_FILES = ["pricing.js", "variants.js"] as const;

export async function buildReplayBundle(db: Db, sampleLimit: number): Promise<ReplayBundle> {
  const modules = await readDeployedModules();

  const candidates: ReplayCandidate[] = listDeployRecords(db)
    .map((row) => ({
      version: row.version,
      variant: row.variant,
      commitSha: row.commit_sha,
      commitMessage: row.commit_message,
      deployedAt: row.deployed_at,
      active: row.active === 1,
    }))
    .sort((a, b) => a.deployedAt.localeCompare(b.deployedAt));

  const samples: ReplaySample[] = listRequestSamples(db, sampleLimit).map((row) => ({
    ts: row.ts,
    observedVersion: row.version,
    observedStatus: row.status_code,
    request: JSON.parse(row.payload) as unknown,
  }));

  return {
    generatedAt: new Date().toISOString(),
    entryModule: "variants.js",
    modules,
    candidates,
    samples,
    harness: HARNESS_SOURCE,
    runner: RUNNER_SOURCE,
    howToRun: HOW_TO_RUN,
  };
}

async function readDeployedModules(): Promise<Record<string, string>> {
  const here = dirname(fileURLToPath(import.meta.url));
  const searchPaths = [here, resolve(here, "..", "dist")];
  const failures: string[] = [];
  for (const directory of searchPaths) {
    try {
      const modules: Record<string, string> = {};
      for (const file of MODULE_FILES) {
        modules[file] = stripSourceMapComment(await readFile(join(directory, file), "utf8"));
      }
      return modules;
    } catch (error) {
      failures.push(`${directory}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(
    `Cannot locate the compiled checkout modules needed for replay. Run the package build first. Tried -> ${failures.join("; ")}`,
  );
}

function stripSourceMapComment(source: string): string {
  return source.replace(/\n?\/\/# sourceMappingURL=.*$/g, "\n");
}

const HOW_TO_RUN = [
  "Do not copy this bundle through your context; it is large.",
  "If the tool result was saved to a file, use that path as BUNDLE.",
  "Otherwise write the tool result verbatim to bundle.json and use that as BUNDLE.",
  "Then run exactly two commands:",
  "python3 -c \"import json,sys;print(json.load(open(sys.argv[1]))['runner'])\" BUNDLE > runner.py",
  "python3 runner.py BUNDLE",
  "The runner provisions Node if the sandbox has none, then replays every recorded",
  "request against every candidate version and prints one JSON object with results,",
  "status, firstBadVersion and lastGoodVersion. Do not write your own replay implementation:",
  "a replay you wrote yourself tests your paraphrase, not the deployed code.",
].join(" ")

const RUNNER_SOURCE = `import hashlib, hmac, json, os, shutil, subprocess, sys, tarfile, tempfile, urllib.request

NODE_VERSION = "v22.11.0"
NODE_DIR = "node-" + NODE_VERSION + "-linux-x64"
NODE_TGZ = "https://nodejs.org/dist/" + NODE_VERSION + "/" + NODE_DIR + ".tar.gz"
NODE_SHA256 = "4f862bab52039835efbe613b532238b6e4dde98d139a34e6923193e073438b13"

def node_binary(workdir):
    found = shutil.which("node")
    if found:
        return found
    local = os.path.join(workdir, NODE_DIR, "bin", "node")
    if os.path.exists(local):
        return local
    archive_path = os.path.join(workdir, "node.tar.gz")
    urllib.request.urlretrieve(NODE_TGZ, archive_path)
    digest = hashlib.sha256()
    with open(archive_path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    if not hmac.compare_digest(digest.hexdigest(), NODE_SHA256):
        raise RuntimeError("downloaded Node archive failed SHA-256 verification")
    with tarfile.open(archive_path, "r:gz") as archive:
        if hasattr(tarfile, "data_filter"):
            archive.extractall(workdir, filter="data")
        else:
            extract_safely(archive, workdir)
    return local

def extract_safely(archive, workdir):
    root = os.path.realpath(workdir)
    for member in archive.getmembers():
        if not (member.isfile() or member.isdir()):
            continue
        target = os.path.realpath(os.path.join(root, member.name))
        if target != root and not target.startswith(root + os.sep):
            raise RuntimeError("refusing to extract outside the working directory: " + member.name)
        archive.extract(member, root)

def main():
    bundle_path = os.path.abspath(sys.argv[1])
    with open(bundle_path) as handle:
        bundle = json.load(handle)
    with tempfile.TemporaryDirectory(prefix="vigil-replay-") as workdir:
        harness_path = os.path.join(workdir, "harness.mjs")
        with open(harness_path, "x") as handle:
            handle.write(bundle["harness"])
        node = node_binary(workdir)
        result = subprocess.run(
            [node, harness_path, bundle_path],
            capture_output=True,
            text=True,
            cwd=workdir,
        )
    if result.returncode != 0:
        print(json.dumps({"error": "replay failed", "stderr": result.stderr[-2000:]}))
        sys.exit(1)
    print(result.stdout)

main()
`;

const HARNESS_SOURCE = `import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const bundle = JSON.parse(readFileSync(process.argv[2], "utf8"));
mkdirSync("./candidate", { recursive: true });
for (const [name, source] of Object.entries(bundle.modules)) {
  writeFileSync("./candidate/" + name, source);
}

const { resolveVariant } = await import("./candidate/variants.js");

const results = [];
for (const candidate of bundle.candidates) {
  let passed = 0;
  let failed = 0;
  const failureMessages = new Map();
  const price = resolveVariant(candidate.variant);
  for (const sample of bundle.samples) {
    try {
      price(sample.request);
      passed += 1;
    } catch (error) {
      failed += 1;
      const key = error instanceof Error ? error.message : String(error);
      failureMessages.set(key, (failureMessages.get(key) ?? 0) + 1);
    }
  }
  const total = passed + failed;
  results.push({
    version: candidate.version,
    variant: candidate.variant,
    commitSha: candidate.commitSha,
    commitMessage: candidate.commitMessage,
    replayed: total,
    passed,
    failed,
    errorRate: total === 0 ? 0 : Number((failed / total).toFixed(4)),
    failureModes: [...failureMessages.entries()].map(([message, count]) => ({ message, count })),
  });
}

let firstBad = null;
let lastGood = null;
for (const result of results) {
  if (result.failed > 0 && firstBad === null) {
    firstBad = result.version;
  }
  if (result.replayed > 0 && result.failed === 0 && firstBad === null) {
    lastGood = result.version;
  }
}

const status = bundle.samples.length === 0 ? "inconclusive_no_samples" : "complete";
console.log(JSON.stringify({ status, results, firstBadVersion: firstBad, lastGoodVersion: lastGood }, null, 2));
`;
