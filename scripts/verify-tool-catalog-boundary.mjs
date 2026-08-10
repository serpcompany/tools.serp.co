import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

const CATALOG_IMPLEMENTATIONS = new Set([
  'packages/app-core/src/lib/tool-catalog-adapter.mjs',
  'packages/app-core/src/lib/tool-catalog.ts',
]);

const APPROVED_RAW_REGISTRY_MUTATORS = new Set([
  'scripts/sync-downloader-landers-from-registry.mjs',
]);

const RAW_REGISTRY_FIXTURE_TESTS = new Set([
  'scripts/catalog-sync-behavior.test.mjs',
]);

const STRUCTURAL_CHECK_SOURCES = new Set([
  'scripts/tool-catalog-boundary.test.mjs',
  'scripts/verify-tool-catalog-boundary.mjs',
]);

const maintainedSourcePath = /^(?:apps\/tools|packages|scripts)\/.*\.(?:[cm]?[jt]sx?)$/;
const rawRegistryPath = /(?:^|\/)tools\.json(?:$|[?#])/;
const retiredCompatibilityModule = /(?:tool-directory|tool-operations)(?:\.[^/]*)?$/;

function guidance(path, problem) {
  return `${path}: ${problem} Use @serp-tools/app-core/lib/tool-catalog for application code or @serp-tools/app-core/lib/tool-catalog-adapter for maintained Node.js harness code. Catalog mutators must isolate raw reads and writes at their approved owned-output boundary.`;
}

export function findToolCatalogBoundaryViolations(sources) {
  const violations = [];
  for (const { path, source } of sources) {
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(path),
    );
    if (
      !allowsRawRegistryPath(path) &&
      containsRawRegistryPath(sourceFile)
    ) {
      violations.push(
        guidance(path, 'direct Tool registry access is not permitted.'),
      );
    }
    if (importsRetiredCompatibilityModule(sourceFile)) {
      violations.push(
        guidance(
          path,
          'importing a retired Tool catalog compatibility module is not permitted.',
        ),
      );
    }
    if (
      !CATALOG_IMPLEMENTATIONS.has(path) &&
      reconstructsCatalogPublicationFilter(sourceFile)
    ) {
      violations.push(
        guidance(
          path,
          'reconstructing active Tool publication filtering is not permitted.',
        ),
      );
    }
  }
  return violations;
}

function allowsRawRegistryPath(sourcePath) {
  return (
    CATALOG_IMPLEMENTATIONS.has(sourcePath) ||
    APPROVED_RAW_REGISTRY_MUTATORS.has(sourcePath) ||
    RAW_REGISTRY_FIXTURE_TESTS.has(sourcePath)
  );
}

function scriptKind(sourcePath) {
  if (/\.tsx$/.test(sourcePath)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(sourcePath)) return ts.ScriptKind.JSX;
  if (/\.[cm]?ts$/.test(sourcePath)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function visitTree(node, predicate) {
  if (predicate(node)) return true;
  let matched = false;
  ts.forEachChild(node, (child) => {
    if (!matched && visitTree(child, predicate)) matched = true;
  });
  return matched;
}

function containsRawRegistryPath(sourceFile) {
  return visitTree(
    sourceFile,
    (node) =>
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      rawRegistryPath.test(node.text.replaceAll('\\', '/')),
  );
}

function importsRetiredCompatibilityModule(sourceFile) {
  return visitTree(sourceFile, (node) => {
    let specifier;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      specifier = node.moduleSpecifier;
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      [specifier] = node.arguments;
    }
    return (
      specifier !== undefined &&
      ts.isStringLiteral(specifier) &&
      retiredCompatibilityModule.test(specifier.text)
    );
  });
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isCatalogNamespaceExpression(expression, catalogNamespaceAliases) {
  const current = unwrapExpression(expression);
  return ts.isIdentifier(current) && catalogNamespaceAliases.has(current.text);
}

function isCatalogObjectExpression(
  expression,
  catalogObjectAliases,
  catalogNamespaceAliases,
) {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return catalogObjectAliases.has(current.text);
  return (
    ts.isPropertyAccessExpression(current) &&
    ['toolCatalog', 'operationalToolCatalog'].includes(current.name.text) &&
    isCatalogNamespaceExpression(current.expression, catalogNamespaceAliases)
  );
}

function isCatalogToolsExpression(
  expression,
  catalogObjectAliases,
  catalogNamespaceAliases,
  catalogToolAliases,
) {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return catalogToolAliases.has(current.text);
  return (
    ts.isPropertyAccessExpression(current) &&
    current.name.text === 'tools' &&
    isCatalogObjectExpression(
      current.expression,
      catalogObjectAliases,
      catalogNamespaceAliases,
    )
  );
}

function collectCatalogAliases(sourceFile) {
  const catalogObjectAliases = new Set();
  const catalogNamespaceAliases = new Set();
  const catalogToolAliases = new Set();
  visitTree(sourceFile, (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      /tool-catalog(?:-adapter)?(?:\.[cm]?[jt]s)?$/.test(
        node.moduleSpecifier.text,
      ) &&
      node.importClause?.namedBindings
    ) {
      if (ts.isNamespaceImport(node.importClause.namedBindings)) {
        catalogNamespaceAliases.add(node.importClause.namedBindings.name.text);
      } else {
        for (const element of node.importClause.namedBindings.elements) {
          const importedName = element.propertyName?.text ?? element.name.text;
          if (['toolCatalog', 'operationalToolCatalog'].includes(importedName)) {
            catalogObjectAliases.add(element.name.text);
          }
        }
      }
    }
    return false;
  });

  let changed;
  do {
    changed = false;
    visitTree(sourceFile, (node) => {
      if (!ts.isVariableDeclaration(node) || !node.initializer) return false;
      if (ts.isIdentifier(node.name)) {
        if (
          isCatalogNamespaceExpression(
            node.initializer,
            catalogNamespaceAliases,
          ) &&
          !catalogNamespaceAliases.has(node.name.text)
        ) {
          catalogNamespaceAliases.add(node.name.text);
          changed = true;
        }
        if (
          isCatalogObjectExpression(
            node.initializer,
            catalogObjectAliases,
            catalogNamespaceAliases,
          ) &&
          !catalogObjectAliases.has(node.name.text)
        ) {
          catalogObjectAliases.add(node.name.text);
          changed = true;
        }
        if (
          isCatalogToolsExpression(
            node.initializer,
            catalogObjectAliases,
            catalogNamespaceAliases,
            catalogToolAliases,
          ) &&
          !catalogToolAliases.has(node.name.text)
        ) {
          catalogToolAliases.add(node.name.text);
          changed = true;
        }
      } else if (
        ts.isObjectBindingPattern(node.name) &&
        isCatalogObjectExpression(
          node.initializer,
          catalogObjectAliases,
          catalogNamespaceAliases,
        )
      ) {
        for (const element of node.name.elements) {
          const propertyName = element.propertyName?.getText(sourceFile);
          if (
            (propertyName === 'tools' ||
              (propertyName === undefined && element.name.getText(sourceFile) === 'tools')) &&
            ts.isIdentifier(element.name) &&
            !catalogToolAliases.has(element.name.text)
          ) {
            catalogToolAliases.add(element.name.text);
            changed = true;
          }
        }
      }
      return false;
    });
  } while (changed);

  return {
    catalogNamespaceAliases,
    catalogObjectAliases,
    catalogToolAliases,
  };
}

function reconstructsCatalogPublicationFilter(sourceFile) {
  const {
    catalogNamespaceAliases,
    catalogObjectAliases,
    catalogToolAliases,
  } = collectCatalogAliases(sourceFile);

  return visitTree(sourceFile, (node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      node.expression.name.text !== 'filter' ||
      !isCatalogToolsExpression(
        node.expression.expression,
        catalogObjectAliases,
        catalogNamespaceAliases,
        catalogToolAliases,
      )
    ) {
      return false;
    }
    const callback = node.arguments[0];
    return (
      callback !== undefined &&
      (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
      visitTree(callback, (part) => ts.isIdentifier(part) && part.text === 'isActive')
    );
  });
}

function trackedMaintainedSources() {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'Unable to enumerate tracked sources');
  }
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .filter((path) => maintainedSourcePath.test(path))
    .filter((path) => !STRUCTURAL_CHECK_SOURCES.has(path))
    .filter((sourcePath) => existsSync(path.join(repositoryRoot, sourcePath)))
    .map((sourcePath) => ({
      path: sourcePath,
      source: readFileSync(path.join(repositoryRoot, sourcePath), 'utf8'),
    }));
}

export function verifyRepositoryToolCatalogBoundary() {
  return findToolCatalogBoundaryViolations(trackedMaintainedSources());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = verifyRepositoryToolCatalogBoundary();
  if (violations.length) {
    console.error(violations.join('\n'));
    process.exitCode = 1;
  }
}
