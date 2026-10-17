// The [tool] route (app/(convert)/[tool]/page.tsx) serves every Tool that has
// no folder of its own: about 2,000 converters and nearly all downloader
// Landers. It renders each page on its first request and serves it from the
// incremental cache afterwards (issue #315). These checks fail if it would
// become dynamic again: a segment config that forces it, or a server module
// it renders that reads request data. Its pages aren't built ahead, so Next.js
// wouldn't notice the second at build time: every such page would answer 500,
// "Page changed from static to dynamic at runtime".

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(appRoot, "../..");
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

function parse(filePath) {
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
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

function isClientModule(sourceFile) {
  const first = sourceFile.statements[0];
  return Boolean(
    first &&
      ts.isExpressionStatement(first) &&
      ts.isStringLiteral(first.expression) &&
      first.expression.text === "use client",
  );
}

// Every module a file imports or re-exports, with the names it imports.
function moduleReferences(sourceFile) {
  const references = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const names = [];
      const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : node.exportClause;
      if (bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) {
        for (const element of bindings.elements) {
          names.push((element.propertyName ?? element.name).text);
        }
      }
      references.push({ specifier: node.moduleSpecifier.text, names });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      references.push({ specifier: node.arguments[0].text, names: [] });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

function compilerOptions() {
  const configPath = path.join(appRoot, "tsconfig.json");
  const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
  return ts.parseJsonConfigFileContent(config, ts.sys, appRoot).options;
}

// The request-time APIs that the server modules reachable from these entry
// files use, as "<file>: <module> <name>". A client module ("use client")
// can't use them, so its imports aren't followed.
function requestApiUses(entryFiles) {
  const options = compilerOptions();
  const uses = [];
  const seen = new Set();
  const queue = [...entryFiles];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const sourceFile = parse(file);
    if (isClientModule(sourceFile)) continue;
    for (const { specifier, names } of moduleReferences(sourceFile)) {
      if (REQUEST_APIS.has(specifier)) {
        const apis = REQUEST_APIS.get(specifier);
        const used = apis ? names.filter((name) => apis.has(name)) : [names.join(", ") || "*"];
        for (const name of used) {
          uses.push(`${path.relative(repoRoot, file)}: ${specifier} ${name}`);
        }
        continue;
      }
      const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule;
      if (!resolved || resolved.resolvedFileName.endsWith(".d.ts")) continue;
      const real = realpathSync(resolved.resolvedFileName);
      // The repository's own modules, including workspace packages; not
      // third-party code.
      if (!real.startsWith(repoRoot + path.sep) || real.split(path.sep).includes("node_modules")) continue;
      if (!/\.(?:[cm]?[jt]sx?)$/.test(real)) continue;
      queue.push(real);
    }
  }
  return { uses, modules: seen.size };
}

test("[tool] renders on demand and is cached: static params, no forced dynamic config", () => {
  const exports = pageExports(parse(pagePath));

  assert.ok(exports.has("generateStaticParams"), "[tool] must export generateStaticParams");
  assert.equal(
    literalValue(exports.get("dynamicParams")),
    true,
    "[tool] must export dynamicParams = true: a Tool not listed by generateStaticParams renders on its first request",
  );
  assert.notEqual(literalValue(exports.get("dynamic")), "force-dynamic", "[tool] must not force dynamic rendering");
  assert.notEqual(literalValue(exports.get("revalidate")), 0, "revalidate = 0 renders [tool] on every request");
  assert.ok(
    !["force-no-store", "default-no-store"].includes(literalValue(exports.get("fetchCache"))),
    "an uncached fetch config renders [tool] on every request",
  );
  assert.doesNotMatch(
    readFileSync(pagePath, "utf8"),
    /\bsearchParams\b/,
    "[tool] must not read searchParams: they make a page dynamic",
  );
});

test("[tool] and the segments around it read no request data", () => {
  const segmentDirs = [path.join(appRoot, "app"), path.dirname(routeDir), routeDir];
  const entries = [pagePath];
  for (const dir of segmentDirs) {
    for (const name of SEGMENT_FILES) {
      const file = path.join(dir, `${name}.tsx`);
      if (existsSync(file)) entries.push(file);
    }
  }

  const { uses, modules } = requestApiUses(entries);

  // The walk reaches the renderers and their templates, not only the page.
  assert.ok(modules > 20, `expected the [tool] page's module graph, found ${modules} modules`);
  assert.deepEqual(uses, [], "server modules [tool] renders must not use request-time APIs");
});
