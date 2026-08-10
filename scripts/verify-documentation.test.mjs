import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const verifierPath = fileURLToPath(
  new URL('./verify-documentation.mjs', import.meta.url),
);
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

function writeFixtureFile(root, relativePath, contents) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function createDocumentationFixture(testContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'tools-serp-documentation-'));
  const documents = {
    'AGENTS.md': '# Agent routes\n',
    'ARCHITECTURE.md':
      '# Architecture\n\nSee the [work-state definition](./CONTEXT.md#work-state).\n',
    'CONTEXT.md': '# Domain glossary\n\n## Work state\n',
    'README.md': '# Project\n',
    'docs/agents/guide.md': '# Agent guide\n',
    'packages/example/README.md': '# Example package\n',
  };

  for (const [relativePath, contents] of Object.entries(documents)) {
    writeFixtureFile(root, relativePath, contents);
  }

  writeFixtureFile(
    root,
    'docs/README.md',
    [
      '# Documentation index',
      '',
      '- [Agent routes](../AGENTS.md)',
      '- [Architecture](../ARCHITECTURE.md)',
      '- [Domain glossary](../CONTEXT.md)',
      '- [Project overview](../README.md)',
      '- [Agent guide](./agents/guide.md)',
      '- [Example package](../packages/example/README.md)',
      '',
    ].join('\n'),
  );

  testContext.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function runVerifier(root) {
  return spawnSync(process.execPath, [verifierPath, '--root', root], {
    encoding: 'utf8',
  });
}

test('documentation verifier accepts an indexed tree with resolvable links', (t) => {
  const root = createDocumentationFixture(t);
  const result = runVerifier(root);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('documentation verifier ignores local run artifacts', (t) => {
  const root = createDocumentationFixture(t);
  writeFixtureFile(
    root,
    '.artifacts/runs/example/report.md',
    '# Local run report\n',
  );

  const result = runVerifier(root);

  assert.equal(result.status, 0, result.stderr);
});

test('documentation verifier reports durable Markdown missing from the index', (t) => {
  const root = createDocumentationFixture(t);
  writeFixtureFile(root, 'docs/runbooks/orphan.md', '# Orphan runbook\n');
  const result = runVerifier(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /unindexed-document: docs\/runbooks\/orphan\.md \(add a Markdown link in docs\/README\.md\)/,
  );
});

test('an unused reference definition does not count as an indexed document', (t) => {
  const root = createDocumentationFixture(t);
  writeFixtureFile(root, 'docs/runbooks/orphan.md', '# Orphan runbook\n');
  writeFixtureFile(
    root,
    'docs/README.md',
    `${readFileSync(path.join(root, 'docs/README.md'), 'utf8')}\n[orphan]: ./runbooks/orphan.md\n`,
  );
  const result = runVerifier(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unindexed-document: docs\/runbooks\/orphan\.md/);
});

test('documentation verifier reports broken internal links at their source', (t) => {
  const root = createDocumentationFixture(t);
  writeFixtureFile(
    root,
    'docs/agents/guide.md',
    '# Agent guide\n\nRead the [missing runbook](../runbooks/missing.md).\n',
  );
  const result = runVerifier(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /broken-link: docs\/agents\/guide\.md:3 -> \.\.\/runbooks\/missing\.md \(target not found\)/,
  );
});

test('documentation verifier reports a fragment that does not match a heading', (t) => {
  const root = createDocumentationFixture(t);
  writeFixtureFile(
    root,
    'docs/agents/guide.md',
    '# Agent guide\n\nRead the [missing section](#missing-heading).\n',
  );
  const result = runVerifier(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /broken-link: docs\/agents\/guide\.md:3 -> #missing-heading \(heading #missing-heading not found in docs\/agents\/guide\.md\)/,
  );
});

test('documentation verifier validates reference-style internal link targets', (t) => {
  const root = createDocumentationFixture(t);
  writeFixtureFile(
    root,
    'docs/agents/guide.md',
    '# Agent guide\n\nRead the [missing section][architecture].\n\n[architecture]: ../../ARCHITECTURE.md#missing-heading\n',
  );
  const result = runVerifier(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /broken-link: docs\/agents\/guide\.md:5 -> \.\.\/\.\.\/ARCHITECTURE\.md#missing-heading \(heading #missing-heading not found in ARCHITECTURE\.md\)/,
  );
});

for (const retiredCategory of ['knowledge', 'plans', 'planner']) {
  test(`documentation verifier rejects new docs/${retiredCategory} catch-all content`, (t) => {
    const root = createDocumentationFixture(t);
    writeFixtureFile(
      root,
      `docs/${retiredCategory}/new-document.md`,
      '# New catch-all document\n',
    );
    const result = runVerifier(root);

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      new RegExp(
        `retired-document-category: docs/${retiredCategory}/new-document\\.md \\(move current guidance to an owned runbook or package README; move dated evidence to docs/audits\\)`,
      ),
    );
  });
}

test('documentation verifier rejects pre-migration catch-all documents', (t) => {
  const root = createDocumentationFixture(t);
  writeFixtureFile(
    root,
    'docs/knowledge/category-pages.md',
    '# Category pages\n',
  );
  writeFixtureFile(
    root,
    'docs/README.md',
    `${readFileSync(path.join(root, 'docs/README.md'), 'utf8')}- [Category pages](./knowledge/category-pages.md)\n`,
  );

  const result = runVerifier(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /retired-document-category: docs\/knowledge\/category-pages\.md/,
  );
});

test('repository documentation satisfies the structural contract', () => {
  const result = runVerifier(repositoryRoot);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});
