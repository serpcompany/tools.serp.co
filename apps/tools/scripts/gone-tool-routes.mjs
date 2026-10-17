// Writes lib/gone-tool-routes.generated.js (issue #322): the retired Tool
// routes that answer 410 Gone, from the catalog and keywords.csv
// (scripts/lib/gone-tool-routes.mjs). `build` and `dev` run it first, so
// middleware.ts always bundles the list for the catalog being built, without
// the catalog itself.
//
//   node scripts/gone-tool-routes.mjs

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GONE_ROUTES_MODULE,
  goneRoutesModuleSource,
  readGoneToolRoutes,
} from "./lib/gone-tool-routes.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath = path.join(appRoot, GONE_ROUTES_MODULE);

const routes = readGoneToolRoutes(appRoot);
const source = goneRoutesModuleSource(routes);
// An unchanged list keeps its file, so a dev server doesn't reload for it.
if (!existsSync(outPath) || readFileSync(outPath, "utf8") !== source) {
  writeFileSync(outPath, source);
}
console.log(`${routes.length} retired Tool routes answer 410: ${GONE_ROUTES_MODULE}`);
