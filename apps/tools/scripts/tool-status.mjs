// Tool status view (issue #232): one generated CSV that lays every Tool and
// every keyword side by side, joined by registry Tool id, so nobody keeps a
// tracker by hand. It reads, and never overrides:
//
//   - catalog intent: lib/catalog/tools.json (live or retired);
//   - verification evidence: benchmarks/tool-sweep-results.json (status,
//     error or reason, and the commit each row was measured at);
//   - processing location, inferred (not observed) from the sweep's engine
//     label through ENGINE_LOCATIONS in scripts/lib/tool-sweep.mjs, which
//     must list every label; download Tools are server-assisted-or-extension;
//   - keyword demand: data/keywords.csv (built by `pnpm -C apps/tools keywords`).
//
//   pnpm -C apps/tools tool-status
//
// It writes benchmarks/tool-status.csv, one row per catalog Tool plus one row
// per keyword with no Tool of its own id ("alias page" or "not built"), and
// benchmarks/tool-status-summary.md, the counts, formatted by Prettier. Run it
// after a sweep, a catalog change or a keyword import, and commit both files:
// lib/tool-status.test.mjs fails when either differs from a fresh run. On a
// merge conflict, regenerate instead of merging by hand.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { STATUS_OUTPUTS, generateToolStatus } from "./lib/tool-status.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { csv, summary } = await generateToolStatus(appRoot);

writeFileSync(path.join(appRoot, STATUS_OUTPUTS.view), csv);
writeFileSync(path.join(appRoot, STATUS_OUTPUTS.summary), summary);
process.stdout.write(summary);
