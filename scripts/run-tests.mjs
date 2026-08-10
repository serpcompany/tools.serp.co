#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const JAVASCRIPT_PATHSPECS = [
  '*.js',
  '*.cjs',
  '*.mjs',
  '*.jsx',
  '*.ts',
  '*.cts',
  '*.mts',
  '*.tsx',
];
const TEST_PATHSPECS = JAVASCRIPT_PATHSPECS.map((pathPattern) =>
  pathPattern.replace('*.', '*.test.'),
);
const TEST_FILE_NAME = /\.test\.(?:[cm]?[jt]s|[jt]sx)$/;

function importsNodeTest(relativePath, sourceText) {
  const sourceFile = ts.createSourceFile(
    relativePath,
    sourceText,
    ts.ScriptTarget.Latest,
    false,
  );
  let found = false;

  function visit(node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === 'node:test'
    ) {
      found = true;
      return;
    }

    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression) &&
      node.moduleReference.expression.text === 'node:test'
    ) {
      found = true;
      return;
    }

    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === 'node:test' &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    ) {
      found = true;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

function parseRoot(args) {
  const rootIndex = args.indexOf('--root');
  if (rootIndex === -1) {
    return process.cwd();
  }

  const root = args[rootIndex + 1];
  if (!root) {
    throw new Error('--root requires a directory');
  }

  return path.resolve(root);
}

function testOwner(relativePath) {
  const [area, name] = relativePath.split('/');
  if (area === 'apps' && name) {
    return `app:${name}`;
  }
  if (area === 'packages' && name) {
    return `package:${name}`;
  }
  if (area === 'scripts') {
    return 'repository:harness';
  }
  return 'repository:root';
}

function committedTestFiles(root) {
  const importResult = spawnSync(
    'git',
    [
      'grep',
      '-l',
      '-z',
      '--fixed-strings',
      'node:test',
      '--',
      ...JAVASCRIPT_PATHSPECS,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  if (importResult.status !== 0 && importResult.status !== 1) {
    process.stderr.write(
      `test-discovery-error: ${importResult.stderr.trim()}\n`,
    );
    process.exit(1);
  }

  const testFiles = importResult.stdout
    .split('\0')
    .filter(Boolean)
    .filter((relativePath) =>
      importsNodeTest(
        relativePath,
        readFileSync(path.join(root, relativePath), 'utf8'),
      ),
    )
    .sort();
  const misplacedTests = testFiles.filter(
    (relativePath) => !TEST_FILE_NAME.test(relativePath),
  );
  if (misplacedTests.length > 0) {
    for (const relativePath of misplacedTests) {
      process.stderr.write(
        `test-discovery-error: ${relativePath} imports node:test but is not named *.test.<js extension>\n`,
      );
    }
    process.exit(1);
  }

  const namedResult = spawnSync(
    'git',
    ['ls-files', '-z', '--', ...TEST_PATHSPECS],
    { cwd: root, encoding: 'utf8' },
  );
  if (namedResult.status !== 0) {
    process.stderr.write(
      `test-discovery-error: ${namedResult.stderr.trim()}\n`,
    );
    process.exit(1);
  }

  const importedTests = new Set(testFiles);
  const nonTestEntrypoints = namedResult.stdout
    .split('\0')
    .filter(Boolean)
    .filter((relativePath) => !importedTests.has(relativePath));
  if (nonTestEntrypoints.length > 0) {
    for (const relativePath of nonTestEntrypoints) {
      process.stderr.write(
        `test-discovery-error: ${relativePath} is named like a test but does not import node:test\n`,
      );
    }
    process.exit(1);
  }

  return testFiles;
}

const root = parseRoot(process.argv.slice(2));
const testFiles = committedTestFiles(root);
if (testFiles.length === 0) {
  process.stderr.write(
    'test-discovery-error: no committed node:test files found\n',
  );
  process.exit(1);
}

const groups = new Map();
for (const testFile of testFiles) {
  const owner = testOwner(testFile);
  const ownedTests = groups.get(owner) ?? [];
  ownedTests.push(testFile);
  groups.set(owner, ownedTests);
}

process.stdout.write(
  `test-discovery: ${testFiles.length} committed node:test files across ${groups.size} ownership groups\n`,
);

let failed = false;
for (const [owner, ownedTests] of groups) {
  const noun = ownedTests.length === 1 ? 'file' : 'files';
  process.stdout.write(`[test:${owner}] ${ownedTests.length} ${noun}\n`);
  const result = spawnSync(process.execPath, ['--test', ...ownedTests], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
}
