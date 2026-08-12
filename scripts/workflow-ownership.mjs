import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const APP_ROOT = 'apps/tools/';
const CANONICAL_LIFECYCLE = 'apps/tools/lib/browser-workflow-lifecycle.ts';
const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const TEST_FILE = /\.test\.(?:[cm]?[jt]s|[jt]sx)$/u;
const ROUTE_PRESENTATION_FILE =
  /\/(?:page|layout|template|error|loading|not-found)\.[jt]sx?$/u;

const REMEDIATION = Object.freeze({
  'terminal-telemetry':
    'Delegate execution through workflow.run and create terminal telemetry with apps/tools/lib/browser-workflow-lifecycle.ts.',
  'object-url-delivery':
    'Use the delivery interface from apps/tools/lib/browser-workflow-lifecycle.ts; do not create or revoke delivery object URLs here.',
  'worker-lifecycle':
    'Move Worker creation, cancellation, and cleanup behind the workflow.run processor adapter; presentation modules only render snapshots and outcomes.',
  'streamed-reader':
    'Move stream acquisition and cancellation behind workflow.run; presentation modules must not own ReadableStream readers.',
});

function scriptKind(relativePath) {
  if (relativePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (relativePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (relativePath.endsWith('.js') || relativePath.endsWith('.mjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function parse(relativePath, source) {
  return ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(relativePath),
  );
}

function importedSpecifiers(sourceFile) {
  const specifiers = [];
  for (const statement of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(statement) ||
        ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

function resolveImport(from, specifier, files) {
  let base;
  if (specifier.startsWith('@/')) {
    base = `${APP_ROOT}${specifier.slice(2)}`;
  } else if (specifier.startsWith('.')) {
    base = path.posix.normalize(
      path.posix.join(path.posix.dirname(from), specifier),
    );
  } else {
    return undefined;
  }
  for (const candidate of [
    base,
    ...['.ts', '.tsx', '.js', '.jsx', '.mjs'].map(
      (extension) => `${base}${extension}`,
    ),
    ...['index.ts', 'index.tsx', 'index.js', 'index.mjs'].map((name) =>
      path.posix.join(base, name),
    ),
  ]) {
    if (files.has(candidate)) return candidate;
  }
  return undefined;
}

function reachableFiles(files, parsed) {
  const entries = [...files.keys()].filter(
    (relativePath) =>
      relativePath.startsWith(`${APP_ROOT}app/`) &&
      SOURCE_FILE.test(relativePath) &&
      !TEST_FILE.test(relativePath),
  );
  const reachable = new Set(entries);
  const pending = [...entries];
  while (pending.length > 0) {
    const current = pending.pop();
    const sourceFile = parsed.get(current);
    if (!sourceFile) continue;
    for (const specifier of importedSpecifiers(sourceFile)) {
      const resolved = resolveImport(current, specifier, files);
      if (resolved && !reachable.has(resolved)) {
        reachable.add(resolved);
        pending.push(resolved);
      }
    }
  }
  return reachable;
}

function conceptsFor(relativePath, sourceFile) {
  const concepts = new Map();
  const add = (concept, count = 1) =>
    concepts.set(concept, (concepts.get(concept) ?? 0) + count);
  const telemetryNamespaces = new Set();
  const objectUrlBindings = new Set();
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      statement.importClause?.namedBindings &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      (/(?:^|\/)telemetry(?:\.ts)?$/u.test(statement.moduleSpecifier.text) ||
        statement.moduleSpecifier.text === '@serp-tools/tool-telemetry/client')
    ) {
      const bindings = statement.importClause.namedBindings;
      if (ts.isNamespaceImport(bindings)) {
        telemetryNamespaces.add(bindings.name.text);
      } else if (
        bindings.elements.some(
          (element) =>
            (element.propertyName ?? element.name).text === 'beginToolRun',
        )
      ) {
        add('terminal-telemetry');
      }
    }
  }
  let hasDeliveryName = false;
  let hasDownloadClick = false;
  let objectUrlSites = 0;
  function visit(node) {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Worker'
    ) {
      add('worker-lifecycle');
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      ['URL', 'globalThis.URL', 'window.URL'].includes(
        node.initializer.getText(sourceFile),
      )
    ) {
      for (const element of node.name.elements) {
        const imported = (element.propertyName ?? element.name).getText(
          sourceFile,
        );
        if (imported === 'createObjectURL' || imported === 'revokeObjectURL') {
          objectUrlBindings.add(element.name.getText(sourceFile));
        }
      }
    }
    if (ts.isPropertyAccessExpression(node)) {
      const owner = node.expression.getText(sourceFile);
      const method = node.name.text;
      if (
        ['URL', 'globalThis.URL', 'window.URL'].includes(owner) &&
        (method === 'createObjectURL' || method === 'revokeObjectURL')
      ) {
        objectUrlSites += 1;
      }
      if (method === 'download') hasDeliveryName = true;
      if (method === 'getReader') add('streamed-reader');
    }
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(sourceFile) === 'download'
    ) {
      hasDeliveryName = true;
      hasDownloadClick = true;
    }
    if (ts.isCallExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        objectUrlBindings.has(node.expression.text)
      ) {
        objectUrlSites += 1;
      }
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'click'
      ) {
        hasDownloadClick = true;
      }
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        telemetryNamespaces.has(node.expression.expression.text) &&
        node.expression.name.text === 'beginToolRun'
      ) {
        add('terminal-telemetry');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (
    objectUrlSites > 0 &&
    (relativePath === CANONICAL_LIFECYCLE ||
      (hasDeliveryName && hasDownloadClick))
  ) {
    add('object-url-delivery');
  }
  return concepts;
}

function isPresentationModule(relativePath, reachable) {
  return (
    reachable.has(relativePath) &&
    (relativePath.startsWith(`${APP_ROOT}components/`) ||
      (relativePath.startsWith(`${APP_ROOT}app/`) &&
        ROUTE_PRESENTATION_FILE.test(relativePath)))
  );
}

export function analyzeWorkflowOwnership(inputFiles) {
  const files = new Map(
    [...inputFiles].filter(
      ([relativePath]) =>
        SOURCE_FILE.test(relativePath) && !TEST_FILE.test(relativePath),
    ),
  );
  const parsed = new Map(
    [...files].map(([relativePath, source]) => [
      relativePath,
      parse(relativePath, source),
    ]),
  );
  const reachable = reachableFiles(files, parsed);
  const ownership = new Map();
  const violations = [];

  for (const [relativePath, sourceFile] of parsed) {
    const concepts = conceptsFor(relativePath, sourceFile);
    for (const [concept, sites] of concepts) {
      const paths = ownership.get(concept) ?? [];
      paths.push({ path: relativePath, sites });
      ownership.set(concept, paths);

      const presentation = isPresentationModule(relativePath, reachable);
      const sharedOwnerViolation =
        concept === 'terminal-telemetry' &&
        relativePath !== CANONICAL_LIFECYCLE;
      const objectUrlViolation =
        concept === 'object-url-delivery' &&
        relativePath !== CANONICAL_LIFECYCLE;
      const presentationViolation =
        presentation &&
        (concept === 'worker-lifecycle' || concept === 'streamed-reader');
      if (sharedOwnerViolation || objectUrlViolation || presentationViolation) {
        violations.push({
          path: relativePath,
          concept,
          remediation: REMEDIATION[concept],
        });
      }
    }
  }

  const inventory = Object.fromEntries(
    [...ownership]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([concept, owners]) => [
        concept,
        owners.map(({ path: ownerPath }) => ownerPath).sort(),
      ]),
  );
  const sharedLifecycleConcepts = new Set([
    'object-url-delivery',
    'terminal-telemetry',
  ]);
  return {
    acceptedInterface: 'ToolWorkflow.run(request, options)',
    canonicalLifecycleOwner: CANONICAL_LIFECYCLE,
    reachableImplementationCount: [...ownership].reduce(
      (total, [concept, owners]) =>
        total +
        (sharedLifecycleConcepts.has(concept)
          ? owners
              .filter(({ path: ownerPath }) => reachable.has(ownerPath))
              .reduce((sites, owner) => sites + owner.sites, 0)
          : 0),
      0,
    ),
    duplicateImplementationCount: [...ownership].reduce(
      (total, [concept, owners]) =>
        total +
        (sharedLifecycleConcepts.has(concept)
          ? Math.max(
              0,
              owners.reduce((sites, owner) => sites + owner.sites, 0) - 1,
            )
          : 0),
      0,
    ),
    inventory,
    reachablePresentationModules: [...reachable]
      .filter((relativePath) => isPresentationModule(relativePath, reachable))
      .sort(),
    violations,
  };
}

export function readTrackedSources(repositoryRoot, ref) {
  const names = execFileSync(
    'git',
    ref
      ? ['ls-tree', '-r', '--name-only', ref, '--', APP_ROOT]
      : [
          'ls-files',
          '--cached',
          '--others',
          '--exclude-standard',
          '--',
          APP_ROOT,
        ],
    { cwd: repositoryRoot, encoding: 'utf8' },
  )
    .split('\n')
    .filter(
      (name) =>
        SOURCE_FILE.test(name) &&
        !TEST_FILE.test(name) &&
        !name.startsWith(`${APP_ROOT}public/`) &&
        (ref || existsSync(path.join(repositoryRoot, name))),
    );
  return new Map(
    names.map((name) => [
      name,
      ref
        ? execFileSync('git', ['show', `${ref}:${name}`], {
            cwd: repositoryRoot,
            encoding: 'utf8',
          })
        : readFileSync(path.join(repositoryRoot, name), 'utf8'),
    ]),
  );
}

export function formatViolations(result) {
  return result.violations.map(
    (violation) =>
      `workflow-ownership-error: ${violation.path} owns ${violation.concept}. ${violation.remediation}`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const referenceIndex = process.argv.indexOf('--ref');
  const ref =
    referenceIndex === -1 ? undefined : process.argv[referenceIndex + 1];
  const repositoryRoot = process.cwd();
  const result = analyzeWorkflowOwnership(
    readTrackedSources(repositoryRoot, ref),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const messages = formatViolations(result);
  if (messages.length > 0) {
    process.stderr.write(`${messages.join('\n')}\n`);
    process.exitCode = 1;
  }
}
