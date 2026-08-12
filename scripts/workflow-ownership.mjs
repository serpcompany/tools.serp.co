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
const LIFECYCLE_CONCEPTS = Object.freeze([
  'terminal-telemetry',
  'object-url-delivery',
  'worker-lifecycle',
  'streamed-reader',
  'upload-read-ownership',
  'progress-policy',
]);

const REMEDIATION = Object.freeze({
  'terminal-telemetry':
    'Delegate execution through workflow.run and create terminal telemetry with apps/tools/lib/browser-workflow-lifecycle.ts.',
  'object-url-delivery':
    'Use the delivery interface from apps/tools/lib/browser-workflow-lifecycle.ts; do not create or revoke delivery object URLs here.',
  'worker-lifecycle':
    'Move Worker creation, cancellation, and cleanup behind the workflow.run processor adapter; presentation modules only render snapshots and outcomes.',
  'streamed-reader':
    'Move stream acquisition and cancellation behind workflow.run; presentation modules must not own ReadableStream readers.',
  'upload-read-ownership':
    'Pass selected inputs to the family workflow; byte acquisition belongs behind ToolWorkflow.run.',
  'progress-policy':
    'Render shared workflow snapshots instead of deriving lifecycle progress in presentation code.',
  'missing-workflow-run':
    'Connect this reachable family adapter to the accepted ToolWorkflow.run(request, options) seam.',
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
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
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
    ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].map(
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

function conceptsFor(sourceFile) {
  const concepts = new Map();
  const add = (concept, count = 1) =>
    concepts.set(concept, (concepts.get(concept) ?? 0) + count);
  const objectUrlBindings = new Set();
  let objectUrlSites = 0;
  function visit(node) {
    if (
      ts.isNewExpression(node) &&
      ((ts.isIdentifier(node.expression) &&
        node.expression.text === 'Worker') ||
        (ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'Worker' &&
          ['window', 'globalThis'].includes(
            node.expression.expression.getText(sourceFile),
          )))
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
      if (method === 'getReader') add('streamed-reader');
      if (method === 'arrayBuffer') add('upload-read-ownership');
      if (method === 'reportProgress') {
        add('progress-policy');
      }
    }
    if (
      ts.isNewExpression(node) &&
      ((ts.isIdentifier(node.expression) &&
        node.expression.text === 'FileReader') ||
        (ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'FileReader'))
    ) {
      add('upload-read-ownership');
    }
    if (ts.isCallExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        objectUrlBindings.has(node.expression.text)
      ) {
        objectUrlSites += 1;
      }
      if (ts.isIdentifier(node.expression)) {
        if (node.expression.text === 'reportProgress') {
          add('progress-policy');
        }
      }
    }
    if (ts.isElementAccessExpression(node)) {
      const owner = node.expression.getText(sourceFile);
      const member = node.argumentExpression;
      if (
        ['URL', 'globalThis.URL', 'window.URL'].includes(owner) &&
        ts.isStringLiteral(member) &&
        (member.text === 'createObjectURL' || member.text === 'revokeObjectURL')
      ) {
        objectUrlSites += 1;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (objectUrlSites > 0) add('object-url-delivery', objectUrlSites);
  return concepts;
}

function isPresentationModule(relativePath, reachable) {
  return (
    reachable.has(relativePath) &&
    (relativePath.startsWith(`${APP_ROOT}components/`) ||
      (relativePath.startsWith(`${APP_ROOT}app/`) &&
        (relativePath.endsWith('.tsx') ||
          ROUTE_PRESENTATION_FILE.test(relativePath))))
  );
}

function importGraph(files, parsed) {
  return new Map(
    [...parsed].map(([relativePath, sourceFile]) => [
      relativePath,
      importedSpecifiers(sourceFile)
        .map((specifier) => resolveImport(relativePath, specifier, files))
        .filter(Boolean),
    ]),
  );
}

function reverseImportGraph(graph) {
  const reverse = new Map();
  for (const [importer, imports] of graph) {
    for (const imported of imports) {
      const importers = reverse.get(imported) ?? [];
      importers.push(importer);
      reverse.set(imported, importers);
    }
  }
  return reverse;
}

function registeredFamilyAdapters(parsed) {
  const adapters = new Map();
  for (const [relativePath, sourceFile] of parsed) {
    if (!relativePath.startsWith(`${APP_ROOT}lib/`)) continue;
    const exports = new Set();
    for (const statement of sourceFile.statements) {
      const exported = statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (
        exported &&
        ts.isFunctionDeclaration(statement) &&
        statement.name &&
        /^createBrowser.+Workflow$/u.test(statement.name.text)
      ) {
        exports.add(statement.name.text);
      }
      if (exported && ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            (declaration.name.text === 'genericToolWorkflow' ||
              /^browser.+Workflow$/u.test(declaration.name.text))
          ) {
            exports.add(declaration.name.text);
          }
        }
      }
    }
    if (exports.size > 0) adapters.set(relativePath, exports);
  }
  return adapters;
}

function telemetryOwners(files, parsed) {
  const exportedSymbols = new Map();
  const ownerPaths = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [relativePath, sourceFile] of parsed) {
      const stopsRawTelemetryPropagation =
        relativePath === CANONICAL_LIFECYCLE ||
        relativePath.startsWith(`${APP_ROOT}components/`) ||
        relativePath.startsWith(`${APP_ROOT}app/`);
      const symbols = exportedSymbols.get(relativePath) ?? new Set();
      const localTelemetryBindings = new Set();
      const telemetryNamespaces = new Set();
      const addSymbol = (name) => {
        if (symbols.has(name)) return;
        symbols.add(name);
        changed = true;
      };
      for (const statement of sourceFile.statements) {
        if (
          !(
            ts.isImportDeclaration(statement) ||
            ts.isExportDeclaration(statement)
          ) ||
          !statement.moduleSpecifier ||
          !ts.isStringLiteral(statement.moduleSpecifier)
        )
          continue;
        const specifier = statement.moduleSpecifier.text;
        const directTelemetry =
          specifier === '@serp-tools/tool-telemetry/client';
        const telemetryBoundary =
          directTelemetry ||
          /(?:^|\/)telemetry(?:\.[cm]?[jt]s)?$/u.test(specifier);
        const providerPath = resolveImport(relativePath, specifier, files);
        const providerSymbols = providerPath
          ? exportedSymbols.get(providerPath)
          : undefined;
        const provides = (name) =>
          (telemetryBoundary && name === 'beginToolRun') ||
          Boolean(providerSymbols?.has(name));

        if (ts.isImportDeclaration(statement)) {
          const importClause = statement.importClause;
          if (importClause?.name && providerSymbols?.has('default')) {
            ownerPaths.add(relativePath);
            localTelemetryBindings.add(importClause.name.text);
          }
          const bindings = importClause?.namedBindings;
          if (!bindings) continue;
          if (ts.isNamespaceImport(bindings)) {
            if (telemetryBoundary || (providerSymbols?.size ?? 0) > 0) {
              ownerPaths.add(relativePath);
              telemetryNamespaces.add(bindings.name.text);
            }
            continue;
          }
          for (const element of bindings.elements) {
            if (provides((element.propertyName ?? element.name).text)) {
              ownerPaths.add(relativePath);
              localTelemetryBindings.add(element.name.text);
            }
          }
          continue;
        }

        const clause = statement.exportClause;
        if (!clause) {
          for (const name of providerSymbols ?? []) addSymbol(name);
          if (telemetryBoundary) addSymbol('beginToolRun');
        } else if (ts.isNamedExports(clause)) {
          for (const element of clause.elements) {
            if (!provides((element.propertyName ?? element.name).text))
              continue;
            addSymbol(element.name.text);
            ownerPaths.add(relativePath);
          }
        }
      }
      const containsTelemetryReference = (root) => {
        let found = false;
        function visit(node) {
          if (
            (ts.isIdentifier(node) && localTelemetryBindings.has(node.text)) ||
            (ts.isPropertyAccessExpression(node) &&
              ts.isIdentifier(node.expression) &&
              telemetryNamespaces.has(node.expression.text) &&
              node.name.text === 'beginToolRun')
          ) {
            found = true;
          }
          if (!found) ts.forEachChild(node, visit);
        }
        visit(root);
        return found;
      };
      for (const statement of stopsRawTelemetryPropagation
        ? []
        : sourceFile.statements) {
        if (
          ts.isExportDeclaration(statement) &&
          !statement.moduleSpecifier &&
          statement.exportClause &&
          ts.isNamedExports(statement.exportClause)
        ) {
          for (const element of statement.exportClause.elements) {
            if (
              localTelemetryBindings.has(
                (element.propertyName ?? element.name).text,
              )
            ) {
              addSymbol(element.name.text);
            }
          }
        }
        const exported = statement.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        );
        const defaultExport = statement.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
        );
        if (!exported) continue;
        if (
          ts.isFunctionDeclaration(statement) &&
          statement.name &&
          containsTelemetryReference(statement)
        ) {
          addSymbol(defaultExport ? 'default' : statement.name.text);
        }
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (
              ts.isIdentifier(declaration.name) &&
              declaration.initializer &&
              containsTelemetryReference(declaration.initializer)
            ) {
              addSymbol(declaration.name.text);
            }
          }
        }
      }
      if (!stopsRawTelemetryPropagation) {
        for (const statement of sourceFile.statements) {
          if (
            ts.isExportAssignment(statement) &&
            !statement.isExportEquals &&
            containsTelemetryReference(statement.expression)
          ) {
            addSymbol('default');
          }
        }
      }
      exportedSymbols.set(relativePath, symbols);
    }
  }
  return ownerPaths;
}

function bindingNames(name, names = new Set()) {
  if (ts.isIdentifier(name)) names.add(name.text);
  else ts.forEachChild(name, (child) => bindingNames(child, names));
  return names;
}

function containsAnyIdentifier(root, identifiers) {
  let found = false;
  function visit(node) {
    if (ts.isIdentifier(node) && identifiers.has(node.text)) found = true;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(root);
  return found;
}

function callsAcceptedWorkflowRun(
  sourceFile,
  adapterPath,
  sourcePath,
  factorySymbols,
) {
  const adapterBindings = new Set(factorySymbols);
  let changed = true;
  while (changed) {
    changed = false;
    function collect(node) {
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        containsAnyIdentifier(node.initializer, adapterBindings)
      ) {
        for (const name of bindingNames(node.name)) {
          if (adapterBindings.has(name)) continue;
          adapterBindings.add(name);
          changed = true;
        }
      }
      ts.forEachChild(node, collect);
    }
    collect(sourceFile);
  }
  let accepted = false;
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const isRun =
        (ts.isPropertyAccessExpression(expression) &&
          expression.name.text === 'run') ||
        (ts.isElementAccessExpression(expression) &&
          ts.isStringLiteral(expression.argumentExpression) &&
          expression.argumentExpression.text === 'run');
      if (isRun) {
        const receiver = expression.expression;
        accepted =
          sourcePath === adapterPath ||
          (ts.isIdentifier(receiver) && adapterBindings.has(receiver.text)) ||
          containsAnyIdentifier(receiver, new Set(factorySymbols));
      }
    }
    if (!accepted) ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return accepted;
}

function reachableDependents(relativePath, reverseGraph, reachable) {
  const dependents = new Set([relativePath]);
  const pending = [relativePath];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const importer of reverseGraph.get(current) ?? []) {
      if (!reachable.has(importer) || dependents.has(importer)) continue;
      dependents.add(importer);
      pending.push(importer);
    }
  }
  return dependents;
}

function moduleRole(relativePath, reachable, familyAdapters) {
  if (relativePath === CANONICAL_LIFECYCLE) return 'canonical-owner';
  if (familyAdapters.has(relativePath)) return 'family-adapter';
  if (isPresentationModule(relativePath, reachable)) return 'presentation';
  return 'processor-or-support';
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
  const reverseGraph = reverseImportGraph(importGraph(files, parsed));
  const telemetry = telemetryOwners(files, parsed);
  const familyAdapters = registeredFamilyAdapters(parsed);
  const ownership = new Map();
  const violations = [];

  for (const [relativePath, sourceFile] of parsed) {
    const concepts = new Map();
    if (telemetry.has(relativePath)) concepts.set('terminal-telemetry', 1);
    for (const [concept, sites] of conceptsFor(sourceFile)) {
      concepts.set(concept, sites);
    }
    for (const [concept, sites] of concepts) {
      const paths = ownership.get(concept) ?? [];
      const role = moduleRole(relativePath, reachable, familyAdapters);
      paths.push({ path: relativePath, role, sites });
      ownership.set(concept, paths);

      const forbiddenInPresentation =
        role === 'presentation' && LIFECYCLE_CONCEPTS.includes(concept);
      const forbiddenInFamilyAdapter =
        role === 'family-adapter' &&
        (concept === 'terminal-telemetry' || concept === 'object-url-delivery');
      if (forbiddenInPresentation || forbiddenInFamilyAdapter) {
        violations.push({
          path: relativePath,
          concept,
          remediation: REMEDIATION[concept],
        });
      }
    }
  }

  const familySeamEvidence = {};
  for (const familyAdapter of [...familyAdapters.keys()].sort()) {
    if (!files.has(familyAdapter) || !reachable.has(familyAdapter)) continue;
    const evidence = [
      ...reachableDependents(familyAdapter, reverseGraph, reachable),
    ]
      .filter((relativePath) =>
        callsAcceptedWorkflowRun(
          parsed.get(relativePath),
          familyAdapter,
          relativePath,
          familyAdapters.get(familyAdapter),
        ),
      )
      .sort();
    familySeamEvidence[familyAdapter] = evidence;
    if (evidence.length === 0) {
      violations.push({
        path: familyAdapter,
        concept: 'missing-workflow-run',
        remediation: REMEDIATION['missing-workflow-run'],
      });
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
  const isSharedOwner = (owner) =>
    owner.role === 'canonical-owner' ||
    owner.role === 'presentation' ||
    (owner.role === 'family-adapter' &&
      (owner.concept === 'terminal-telemetry' ||
        owner.concept === 'object-url-delivery'));
  const lifecycleInventory = Object.fromEntries(
    LIFECYCLE_CONCEPTS.map((concept) => {
      const owners = (ownership.get(concept) ?? []).map((owner) => ({
        ...owner,
        concept,
      }));
      const sharedOwners = owners.filter(isSharedOwner);
      const otherOwners = owners.filter((owner) => !isSharedOwner(owner));
      return [
        concept,
        {
          sharedOwnerModules: sharedOwners
            .map(({ path: ownerPath }) => ownerPath)
            .sort(),
          sharedOwnerSites: sharedOwners.reduce(
            (total, owner) => total + owner.sites,
            0,
          ),
          toolSpecificOrSupportModules: otherOwners
            .map(({ path: ownerPath }) => ownerPath)
            .sort(),
          toolSpecificOrSupportSites: otherOwners.reduce(
            (total, owner) => total + owner.sites,
            0,
          ),
        },
      ];
    }),
  );
  const reachableSharedOwners = LIFECYCLE_CONCEPTS.flatMap((concept) =>
    (ownership.get(concept) ?? [])
      .map((owner) => ({ ...owner, concept }))
      .filter((owner) => isSharedOwner(owner) && reachable.has(owner.path)),
  );
  const acceptedOwnerBudget = {
    'terminal-telemetry': 1,
    'object-url-delivery': 1,
    'worker-lifecycle': 0,
    'streamed-reader': 0,
    'upload-read-ownership': 0,
    'progress-policy': 0,
  };
  return {
    acceptedInterface: 'ToolWorkflow.run(request, options)',
    canonicalLifecycleOwner: CANONICAL_LIFECYCLE,
    countDefinitions: {
      implementation:
        'One reachable shared-owner module/concept pair: presentation and canonical lifecycle sites, plus terminal telemetry or object-URL delivery in a family adapter.',
      duplicate:
        'A shared-owner module/concept pair beyond an actually present canonical owner; Tool-specific family-adapter, processor, and support sites are reported but excluded.',
      acceptedOwnerBudget,
    },
    reachableImplementationCount: reachableSharedOwners.length,
    duplicateImplementationCount: LIFECYCLE_CONCEPTS.reduce(
      (total, concept) => {
        const owners = (ownership.get(concept) ?? []).map((owner) => ({
          ...owner,
          concept,
        }));
        const sharedOwnerCount = owners.filter(isSharedOwner).length;
        const presentCanonicalBudget = owners.some(
          (owner) => owner.role === 'canonical-owner',
        )
          ? acceptedOwnerBudget[concept]
          : 0;
        return total + Math.max(0, sharedOwnerCount - presentCanonicalBudget);
      },
      0,
    ),
    inventory,
    lifecycleInventory,
    familySeamEvidence,
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
