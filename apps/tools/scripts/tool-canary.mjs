// Canary sweep (issue #246): runs the Tools in CANARY_TOOLS
// (scripts/lib/tool-canary.mjs) through scripts/tool-sweep.mjs against a local
// Worker and exits 1 if any doesn't pass, so a change that breaks an engine
// fails CI. Results go to a temporary file; the committed
// benchmarks/tool-sweep-results.json is left alone. A canary that fails runs
// once more, and a pass the second time is a warning, not a failure.
//
//   node scripts/tool-canary.mjs --base-url http://localhost:8787 \
//     [--concurrency n] [--channel chrome] [--headed]

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CANARY_TOOLS, failingCanaries } from "./lib/tool-canary.mjs";

const sweepScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "tool-sweep.mjs");
const passThrough = process.argv.slice(2);
const owned = passThrough.filter((arg) => ["--only", "--out", "--resume", "--retry", "--limit", "--summary"].includes(arg));
if (owned.length) throw new Error(`The canary sets the Tools and the output itself; drop ${owned.join(", ")}`);

const ids = Object.keys(CANARY_TOOLS);
const directory = mkdtempSync(path.join(tmpdir(), "tool-canary-"));
const out = path.join(directory, "results.json");
const inActions = process.env.GITHUB_ACTIONS === "true";

function sweep(only) {
  const result = spawnSync(
    process.execPath,
    [...process.execArgv, sweepScript, ...passThrough, "--only", only.join(","), "--out", out],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error(`tool-sweep exited with ${result.status ?? result.signal}`);
  return JSON.parse(readFileSync(out, "utf8")).results;
}

// GitHub Actions shows these on the run and the PR; elsewhere they're plain lines.
function annotate(level, title, message) {
  console.log(inActions ? `::${level} title=${title}::${message.replace(/\r?\n/g, "%0A")}` : `${level}: ${title}: ${message}`);
}

const describe = ({ id, status, error, detail }) =>
  `${id} (${CANARY_TOOLS[id]}): ${status}${error ? `, ${error}` : ""}${detail ? ` [${detail}]` : ""}`;

let exitCode = 1;
try {
  const started = Date.now();
  const first = failingCanaries(sweep(ids), ids);
  const retried = first.length ? sweep(first.map((canary) => canary.id)) : [];
  const failed = first.length ? failingCanaries(retried, first.map((canary) => canary.id)) : [];
  const flaky = first.filter((canary) => !failed.some((row) => row.id === canary.id));
  const rows = JSON.parse(readFileSync(out, "utf8")).results;
  const minutes = ((Date.now() - started) / 60_000).toFixed(1);

  for (const canary of flaky) annotate("warning", "Canary passed on retry", describe(canary));
  for (const canary of failed) annotate("error", "Canary failed", describe(canary));
  console.log(
    `\nCanary sweep: ${ids.length - failed.length} of ${ids.length} passed in ${minutes} min` +
      (flaky.length ? `, ${flaky.length} on the retry` : ""),
  );

  if (process.env.GITHUB_STEP_SUMMARY) {
    const line = (row) => {
      const status = flaky.some((canary) => canary.id === row.id) ? "pass on retry" : row.status;
      return `| \`${row.id}\` | ${CANARY_TOOLS[row.id]} | ${status} | ${((row.durationMs ?? 0) / 1000).toFixed(1)} s |`;
    };
    const table = rows.filter((row) => CANARY_TOOLS[row.id]).map(line);
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [`### Canary sweep: ${ids.length - failed.length} of ${ids.length} passed in ${minutes} min`, "",
        "| Tool | Guards | Status | Time |", "| --- | --- | --- | ---: |", ...table, ""].join("\n"),
    );
  }
  exitCode = failed.length ? 1 : 0;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
process.exit(exitCode);
