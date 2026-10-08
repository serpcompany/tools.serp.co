// Tool status view (issue #232): one generated CSV that lays every Tool and
// every keyword side by side, joined by registry Tool id, so nobody keeps a
// tracker by hand. It reads, and never overrides:
//
//   - catalog intent: lib/catalog/tools.json (live or retired);
//   - verification evidence: benchmarks/tool-sweep-results.json (status,
//     error or reason, commit);
//   - processing location, derived from the sweep's engine: client-only,
//     server-executed, server-first-client-fallback, downloaders'
//     server-assisted-or-extension, or unknown;
//   - keyword demand: data/keywords.csv (built by `pnpm -C apps/tools keywords`).
//
//   pnpm -C apps/tools tool-status
//
// It writes benchmarks/tool-status.csv, one row per catalog Tool plus one
// "not built" row per keyword with no Tool of its own id, and
// benchmarks/tool-status-summary.md, the counts. Run it after a sweep, a
// catalog change or a keyword import, and commit both files:
// lib/tool-status.test.mjs fails when either differs from a fresh run.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { STATUS_OUTPUTS, generateToolStatus } from "./lib/tool-status.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { csv, summary } = generateToolStatus(appRoot);

writeFileSync(path.join(appRoot, STATUS_OUTPUTS.view), csv);
writeFileSync(path.join(appRoot, STATUS_OUTPUTS.summary), summary);
process.stdout.write(summary);
