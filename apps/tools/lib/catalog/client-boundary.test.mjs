// Next.js bundles every module a "use client" module or a web worker imports
// for the browser. The Tool registry is 4 MB, so none of them may reach it:
// Server Components read the catalog and pass client components plain data.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const appRoot = fileURLToPath(new URL("../..", import.meta.url));
const uiRoot = path.resolve(appRoot, "../../packages/ui/src");
const registryPath = path.join(appRoot, "lib/catalog/tools.json");
const SKIPPED_DIRECTORIES = new Set([
  ".next",
  ".open-next",
  ".wrangler",
  "benchmarks",
  "node_modules",
  "public",
  "scripts",
]);
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".d.ts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.mjs",
  "/index.d.ts",
];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name) ? [] : sourceFiles(fullPath);
    }
    return SOURCE_FILE.test(entry.name) && !entry.name.includes(".test.") ? [fullPath] : [];
  });
}

// The file an import names, or null for a package. Workspace packages can't
// import apps/tools (ARCHITECTURE.md), so only the UI sources are followed.
function resolveImport(fromFile, specifier) {
  let base;
  if (specifier.startsWith("@/")) base = path.join(appRoot, specifier.slice(2));
  else if (specifier.startsWith("@serp-tools/ui/")) {
    base = path.join(uiRoot, specifier.slice("@serp-tools/ui/".length));
  } else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;
  for (const extension of EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`${path.relative(appRoot, fromFile)}: cannot resolve "${specifier}"`);
}

const sources = new Map();

function sourceOf(file) {
  if (!sources.has(file)) {
    sources.set(file, ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest));
  }
  return sources.get(file);
}

function isClientModule(file) {
  for (const statement of sourceOf(file).statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    if (statement.expression.text === "use client") return true;
  }
  return false;
}

// The text of a module specifier: a string literal, or an identifier bound to
// a top-level `const` string in the same file (a CDN URL, say). Null for
// anything the walk can't follow.
function specifierText(source, node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isIdentifier(node)) return null;
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== node.text) continue;
      const value = declaration.initializer;
      if (value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))) {
        return value.text;
      }
    }
  }
  return null;
}

const importsCache = new Map();

// The files a module's runtime imports load: static imports and re-exports,
// import() and require(). Type-only imports are erased before bundling, so
// they're skipped. An import() or require() whose module the walk can't name
// fails the test instead of being skipped.
function importsOf(file) {
  if (!SOURCE_FILE.test(file)) return []; // JSON, CSS and other assets
  if (importsCache.has(file)) return importsCache.get(file);
  const specifiers = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const typeOnly =
        clause?.isTypeOnly ||
        (clause &&
          !clause.name &&
          clause.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.length > 0 &&
          clause.namedBindings.elements.every((element) => element.isTypeOnly));
      if (!typeOnly) specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      const specifier = node.arguments[0] && specifierText(source, node.arguments[0]);
      if (specifier === null || specifier === undefined) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        throw new Error(
          `${path.relative(appRoot, file)}:${line + 1}: ${node.getText(source)} names no module the walk can follow`,
        );
      }
      specifiers.push(specifier);
    }
    ts.forEachChild(node, visit);
  };
  const source = sourceOf(file);
  visit(source);
  const imports = specifiers.map((specifier) => resolveImport(file, specifier)).filter(Boolean);
  importsCache.set(file, imports);
  return imports;
}

// The import chain from `file` to the registry, or null.
function chainToRegistry(file, seen = new Set()) {
  if (file === registryPath) return [file];
  if (seen.has(file)) return null;
  seen.add(file);
  for (const imported of importsOf(file)) {
    const chain = chainToRegistry(imported, seen);
    if (chain) return [file, ...chain];
  }
  return null;
}

const relative = (file) => path.relative(appRoot, file);

// Web worker entries, which components load with new Worker(new URL(...)).
const workerEntries = () => sourceFiles(path.join(appRoot, "workers"));

test("no client module or web worker imports the Tool registry, directly or through other modules", () => {
  const clientModules = sourceFiles(appRoot).filter(isClientModule);
  assert.ok(clientModules.length > 20, `found only ${clientModules.length} client modules`);
  const workers = workerEntries();
  assert.ok(workers.length >= 3, `found only ${workers.length} worker entries`);

  const leaks = [...clientModules, ...workers]
    .map((file) => chainToRegistry(file))
    .filter(Boolean)
    .map((chain) => chain.map(relative).join(" -> "));
  assert.deepEqual(leaks, []);
});

test("the import walk does find the registry from the Server Components that read it", () => {
  for (const file of ["app/page.tsx", "components/sections/ToolsLinkHub.tsx"]) {
    const chain = chainToRegistry(path.join(appRoot, file));
    assert.ok(chain, `${file} should reach the registry`);
    assert.equal(relative(chain.at(-1)), "lib/catalog/tools.json");
  }
});
