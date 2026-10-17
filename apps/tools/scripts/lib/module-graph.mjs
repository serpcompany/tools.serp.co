// The repository's own modules that a set of entry files reaches through
// imports, re-exports and dynamic imports, for tests that check what the code
// a page renders may do. Third-party code isn't followed.

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const appRoot = fileURLToPath(new URL("../..", import.meta.url));
export const repoRoot = path.resolve(appRoot, "../..");

const parsed = new Map();

export function parse(filePath) {
  let sourceFile = parsed.get(filePath);
  if (!sourceFile) {
    sourceFile = ts.createSourceFile(filePath, readFileSync(filePath, "utf8"), ts.ScriptTarget.Latest, true);
    parsed.set(filePath, sourceFile);
  }
  return sourceFile;
}

export function isClientModule(sourceFile) {
  const first = sourceFile.statements[0];
  return Boolean(
    first &&
      ts.isExpressionStatement(first) &&
      ts.isStringLiteral(first.expression) &&
      first.expression.text === "use client",
  );
}

// Every module a file imports or re-exports, with the names it imports.
export function moduleReferences(sourceFile) {
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

let options;
function compilerOptions() {
  if (!options) {
    const configPath = path.join(appRoot, "tsconfig.json");
    const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
    options = ts.parseJsonConfigFileContent(config, ts.sys, appRoot).options;
  }
  return options;
}

// Visits every module reachable from the entry files once, as
// visit(sourceFile, file, references). When visit returns false, that
// module's imports aren't followed from there. Returns how many modules it
// visited.
export function walkModules(entryFiles, visit) {
  const seen = new Set();
  const queue = [...entryFiles];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const sourceFile = parse(file);
    const references = moduleReferences(sourceFile);
    if (visit(sourceFile, file, references) === false) continue;
    for (const { specifier } of references) {
      const resolved = ts.resolveModuleName(specifier, file, compilerOptions(), ts.sys).resolvedModule;
      if (!resolved || resolved.resolvedFileName.endsWith(".d.ts")) continue;
      const real = realpathSync(resolved.resolvedFileName);
      // The repository's own modules, including workspace packages; not
      // third-party code.
      if (!real.startsWith(repoRoot + path.sep) || real.split(path.sep).includes("node_modules")) continue;
      if (!/\.(?:[cm]?[jt]sx?)$/.test(real)) continue;
      queue.push(real);
    }
  }
  return seen.size;
}

const ROUTE_FILE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

// The files under `dir` named `<name><extension>` for one of these names,
// such as every page and layout of the app.
export function routeFiles(dir, names) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...routeFiles(file, names));
    } else if (
      ROUTE_FILE_EXTENSIONS.includes(path.extname(entry.name)) &&
      names.includes(path.basename(entry.name, path.extname(entry.name)))
    ) {
      files.push(file);
    }
  }
  return files;
}
