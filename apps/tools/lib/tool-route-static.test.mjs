// The [tool] route (app/(convert)/[tool]/page.tsx) serves every Tool that has
// no folder of its own: about 2,000 converters and nearly all downloader
// Landers. It renders each page on its first request and serves it from the
// incremental cache afterwards (issue #315). These checks fail if it would
// become dynamic again: a segment config, in the page or a layout above it,
// that forces it, or a server module it renders that reads request data. Its
// pages aren't built ahead, so Next.js
// wouldn't notice the second at build time: every such page would answer 500,
// "Page changed from static to dynamic at runtime".

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

import { appRoot, isClientModule, parse, repoRoot, walkModules } from "../scripts/lib/module-graph.mjs";

const routeDir = path.join(appRoot, "app", "(convert)", "[tool]");
const pagePath = path.join(routeDir, "page.tsx");

// Request-time APIs by module: any of them makes a page dynamic.
const REQUEST_APIS = new Map([
  ["next/headers", null], // every export: cookies, headers, draftMode
  ["next/server", new Set(["connection"])],
  ["next/cache", new Set(["unstable_noStore"])],
]);
// The segment files Next.js renders around a page, outermost first.
const SEGMENT_FILES = ["layout", "template", "not-found"];
const SEGMENT_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

// The segment files in the app root, the route group and the route, outermost
// first. A layout's segment config applies to every page below it.
function segmentFiles() {
  const files = [];
  for (const dir of [path.join(appRoot, "app"), path.dirname(routeDir), routeDir]) {
    for (const name of SEGMENT_FILES) {
      for (const extension of SEGMENT_EXTENSIONS) {
        const file = path.join(dir, `${name}${extension}`);
        if (existsSync(file)) files.push(file);
      }
    }
  }
  return files;
}

function hasExportModifier(node) {
  return ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

// The page's exported names, each with its initializer for a const.
function pageExports(sourceFile) {
  const exports = new Map();
  for (const statement of sourceFile.statements) {
    if (!hasExportModifier(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      exports.set(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          exports.set(declaration.name.text, declaration.initializer);
        }
      }
    }
  }
  return exports;
}

function literalValue(node) {
  if (!node) return undefined;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  return undefined;
}

// The request-time APIs that the server modules reachable from these entry
// files use, as "<file>: <module> <name>". A client module ("use client")
// can't use them, so its imports aren't followed.
function requestApiUses(entryFiles) {
  const uses = [];
  const modules = walkModules(entryFiles, (sourceFile, file, references) => {
    if (isClientModule(sourceFile)) return false;
    for (const { specifier, names } of references) {
      if (!REQUEST_APIS.has(specifier)) continue;
      const apis = REQUEST_APIS.get(specifier);
      const used = apis ? names.filter((name) => apis.has(name)) : [names.join(", ") || "*"];
      for (const name of used) {
        uses.push(`${path.relative(repoRoot, file)}: ${specifier} ${name}`);
      }
    }
    return true;
  });
  return { uses, modules };
}

test("[tool] renders on demand and is cached: static params, no forced dynamic config", () => {
  const exports = pageExports(parse(pagePath));

  assert.ok(exports.has("generateStaticParams"), "[tool] must export generateStaticParams");
  assert.equal(
    literalValue(exports.get("dynamicParams")),
    true,
    "[tool] must export dynamicParams = true: a Tool not listed by generateStaticParams renders on its first request",
  );
  assert.doesNotMatch(
    readFileSync(pagePath, "utf8"),
    /\bsearchParams\b/,
    "[tool] must not read searchParams: they make a page dynamic",
  );
});

test("neither [tool] nor a segment above it forces dynamic rendering", () => {
  const files = [pagePath, ...segmentFiles()];
  assert.ok(files.includes(path.join(appRoot, "app", "layout.tsx")), "expected the root layout among the segment files");

  const problems = [];
  for (const file of files) {
    const exports = pageExports(parse(file));
    const where = path.relative(repoRoot, file);
    if (literalValue(exports.get("dynamic")) === "force-dynamic") problems.push(`${where}: dynamic = "force-dynamic"`);
    if (literalValue(exports.get("revalidate")) === 0) problems.push(`${where}: revalidate = 0`);
    if (["force-no-store", "default-no-store"].includes(literalValue(exports.get("fetchCache")))) {
      problems.push(`${where}: fetchCache = "${literalValue(exports.get("fetchCache"))}"`);
    }
    if (file !== pagePath && literalValue(exports.get("dynamicParams")) === false) {
      problems.push(`${where}: dynamicParams = false (a Tool not built ahead would answer 404)`);
    }
  }
  assert.deepEqual(problems, [], "these render [tool] on every request, or stop it rendering on demand");
});

test("[tool] and the segments around it read no request data", () => {
  const { uses, modules } = requestApiUses([pagePath, ...segmentFiles()]);

  // The walk reaches the renderers and their templates, not only the page.
  assert.ok(modules > 20, `expected the [tool] page's module graph, found ${modules} modules`);
  assert.deepEqual(uses, [], "server modules [tool] renders must not use request-time APIs");
});
