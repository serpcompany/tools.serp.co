import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const verifierPath = fileURLToPath(
  new URL('./verify-agent-workflow.mjs', import.meta.url),
);
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const WORKFLOW_ROUTES = [
  'docs/agents/issue-tracker.md',
  'docs/agents/triage-labels.md',
  'docs/agents/domain.md',
  'docs/agents/downloader-lander-links.md',
];

function createWorkflowFixture(
  testContext,
  { agents = WORKFLOW_ROUTES.join('\n') } = {},
) {
  const root = mkdtempSync(path.join(tmpdir(), 'tools-serp-agent-workflow-'));

  writeFileSync(path.join(root, 'AGENTS.md'), agents);
  for (const route of WORKFLOW_ROUTES) {
    const target = path.join(root, route);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, '# Project agent guidance\n');
  }
  testContext.after(() => rmSync(root, { recursive: true, force: true }));

  return root;
}

function runVerifier(root) {
  return spawnSync(process.execPath, [verifierPath, '--root', root], {
    encoding: 'utf8',
  });
}

test('agent workflow reports a missing issue-tracker route without reading unrelated files', (t) => {
  const root = createWorkflowFixture(t, {
    agents: [
      '# Agent instructions',
      'docs/agents/triage-labels.md',
      'docs/agents/domain.md',
      'docs/agents/downloader-lander-links.md',
    ].join('\n'),
  });
  const result = runVerifier(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing-route: docs\/agents\/issue-tracker\.md/);
});

test('agent workflow reports when a routed project document is absent', (t) => {
  const root = createWorkflowFixture(t);
  unlinkSync(path.join(root, 'docs', 'agents', 'domain.md'));
  const result = runVerifier(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing-file: docs\/agents\/domain\.md/);
});

test('agent workflow rejects credential-style arguments without echoing their values', (t) => {
  const root = createWorkflowFixture(t);
  mkdirSync(path.join(root, '.codex'), { recursive: true });
  writeFileSync(
    path.join(root, '.codex', 'config.toml'),
    '[mcp_servers.example]\nargs = ["--header", "Authorization: Bearer super-secret-value"]\n',
  );
  const result = runVerifier(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /unsafe-agent-config: credential-style-argument: \.codex\/config\.toml:2/,
  );
  assert.doesNotMatch(result.stderr, /super-secret-value/);
});

test('agent workflow rejects common credential command arguments', (t) => {
  const root = createWorkflowFixture(t);
  writeFileSync(
    path.join(root, '.mcp.json'),
    '{"command":"example","args":["--api-key","super-secret-value"]}\n',
  );
  const result = runVerifier(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /unsafe-agent-config: credential-style-argument: \.mcp\.json:1/,
  );
  assert.doesNotMatch(result.stderr, /super-secret-value/);
});

test('agent workflow rejects personal absolute paths without echoing the path', (t) => {
  const root = createWorkflowFixture(t);
  mkdirSync(path.join(root, '.codex'), { recursive: true });
  writeFileSync(
    path.join(root, '.codex', 'config.toml'),
    'notify = ["zsh", "/Users/example-person/.codex/notify.sh"]\n',
  );
  const result = runVerifier(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /unsafe-agent-config: personal-absolute-path: \.codex\/config\.toml:1/,
  );
  assert.doesNotMatch(result.stderr, /example-person/);
});

test('agent workflow rejects project-level personal preferences', (t) => {
  const root = createWorkflowFixture(t);
  mkdirSync(path.join(root, '.codex'), { recursive: true });
  writeFileSync(
    path.join(root, '.codex', 'config.toml'),
    '[tui]\nnotifications = true\n',
  );
  const result = runVerifier(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /unsafe-agent-config: project-personal-preference: \.codex\/config\.toml:1/,
  );
});

test('agent workflow rejects JSON personal preferences', (t) => {
  const root = createWorkflowFixture(t);
  mkdirSync(path.join(root, '.claude'), { recursive: true });
  writeFileSync(
    path.join(root, '.claude', 'settings.json'),
    '{"notifications":true}\n',
  );
  const result = runVerifier(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /unsafe-agent-config: project-personal-preference: \.claude\/settings\.json:1/,
  );
});

test('agent workflow rejects mutable project-level agent tooling', (t) => {
  const root = createWorkflowFixture(t);
  mkdirSync(path.join(root, '.codex'), { recursive: true });
  writeFileSync(
    path.join(root, '.codex', 'config.toml'),
    'args = ["-y", "example-agent-tool@latest"]\n',
  );
  const result = runVerifier(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /unsafe-agent-config: mutable-agent-tooling: \.codex\/config\.toml:1/,
  );
});

test('repository agent workflow satisfies the shared safety contract', () => {
  const result = runVerifier(repositoryRoot);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});
