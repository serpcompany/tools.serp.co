// Canary sweep (issue #246): runs the Tools in CANARY_TOOLS
// (scripts/lib/tool-canary.mjs) through scripts/tool-sweep.mjs against a local
// Worker and exits 1 if any doesn't pass, so a change that breaks an engine
// fails CI. Results go to a temporary file; the committed
// benchmarks/tool-sweep-results.json is left alone. A canary that fails runs
// once more, and a pass the second time is a warning, not a failure. When
// most canaries fail, the break is everywhere and nothing runs again.
//
//   node scripts/tool-canary.mjs --base-url http://localhost:8787 \
//     [--concurrency n] [--timeout ms] [--ffmpeg-timeout ms] [--channel chrome] [--headed]

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CANARY_TOOLS, failingCanaries } from "./lib/tool-canary.mjs";

// Shorter than the full sweep's (60 s, and 180 s for FFmpeg): each canary
// takes a few seconds, and a hang must fail inside the CI job's time limit.
const TIMEOUTS = ["--timeout", "20000", "--ffmpeg-timeout", "45000"];

const sweepScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "tool-sweep.mjs");
const passThrough = process.argv.slice(2);
const owned = passThrough.filter((arg) => ["--only", "--out", "--resume", "--retry", "--limit", "--summary"].includes(arg));
if (owned.length) throw new Error(`The canary sets the Tools and the output itself; drop ${owned.join(", ")}`);

const ids = Object.keys(CANARY_TOOLS);
const directory = mkdtempSync(path.join(tmpdir(), "tool-canary-"));
const out = path.join(directory, "results.json");
const inActions = process.env.GITHUB_ACTIONS === "true";

// Ctrl-C reaches the sweep too, which finishes its Tools in progress; wait for
// it, then clean up.
let interrupted = false;
process.on("SIGINT", () => {
  interrupted = true;
});

function sweep(only) {
  const result = spawnSync(
    process.execPath,
    [...process.execArgv, sweepScript, ...TIMEOUTS, ...passThrough, "--only", only.join(","), "--out", out],
    { stdio: "inherit" },
  );
  if (interrupted) throw new Error("Interrupted");
  if (result.status !== 0) throw new Error(`tool-sweep exited with ${result.status ?? result.signal}`);
  return JSON.parse(readFileSync(out, "utf8")).results;
}

// GitHub Actions shows these on the run and the PR; elsewhere they're plain
// lines. Workflow commands escape %, CR and LF in the message.
function annotate(level, title, message) {
  const escaped = message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  console.log(inActions ? `::${level} title=${title}::${escaped}` : `${level}: ${title}: ${message}`);
}

const errorText = ({ error, detail }) => `${error ?? ""}${detail ? ` [${detail}]` : ""}`;
const describe = (canary) => `${canary.id} (${CANARY_TOOLS[canary.id]}): ${canary.status}, ${errorText(canary)}`;

function writeStepSummary(rows, { flaky, heading }) {
  const cell = (text) => String(text).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
  const line = (row) => {
    const status = flaky.some((canary) => canary.id === row.id) ? "pass on retry" : row.status;
    const error = row.status === "pass" ? "" : cell(errorText(row));
    return `| \`${row.id}\` | ${CANARY_TOOLS[row.id]} | ${status} | ${((row.durationMs ?? 0) / 1000).toFixed(1)} s | ${error} |`;
  };
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [`### ${heading}`, "", "| Tool | Guards | Status | Time | Error |", "| --- | --- | --- | ---: | --- |",
      ...rows.filter((row) => CANARY_TOOLS[row.id]).map(line), ""].join("\n"),
  );
}

try {
  const started = Date.now();
  const first = failingCanaries(sweep(ids), ids);
  const systemic = first.length > ids.length / 2;
  const retry = systemic ? [] : first.map((canary) => canary.id);
  const failed = retry.length ? failingCanaries(sweep(retry), retry) : first;
  const flaky = first.filter((canary) => !failed.some((row) => row.id === canary.id));
  const minutes = ((Date.now() - started) / 60_000).toFixed(1);

  for (const canary of flaky) annotate("warning", "Canary passed on retry", describe(canary));
  for (const canary of failed) annotate("error", "Canary failed", describe(canary));
  const heading =
    `Canary sweep: ${ids.length - failed.length} of ${ids.length} passed in ${minutes} min` +
    (flaky.length ? `, ${flaky.length} on the retry` : "") +
    (systemic ? " (most failed, so none ran again)" : "");
  console.log(`\n${heading}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeStepSummary(JSON.parse(readFileSync(out, "utf8")).results, { flaky, heading });
  }
  process.exitCode = failed.length ? 1 : 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = interrupted ? 130 : 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
