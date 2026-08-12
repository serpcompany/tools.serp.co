#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordRunEvidence } from '../../../scripts/lib/run-evidence.mjs';

const previewEnvironment = 'wayfinder-preview';
const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const repositoryRoot = path.resolve(appRoot, '..', '..');
const wranglerConfigPath = path.join(appRoot, 'wrangler.jsonc');

function readPreviewTopology() {
  const config = JSON.parse(readFileSync(wranglerConfigPath, 'utf8'));
  const preview = config.env?.[previewEnvironment];
  const previewWorker = preview?.name;
  const previewOrigin = preview?.vars?.NEXT_PUBLIC_SITE_URL;
  const assetsOrigin = preview?.vars?.NEXT_PUBLIC_ASSETS_BASE_URL;
  if (
    typeof previewWorker !== 'string' ||
    typeof previewOrigin !== 'string' ||
    typeof assetsOrigin !== 'string' ||
    preview?.workers_dev !== true ||
    !Array.isArray(preview?.routes) ||
    preview.routes.length !== 0
  ) {
    fail('Wayfinder preview topology is incomplete or not workers.dev only');
  }
  return { previewWorker, previewOrigin, assetsOrigin };
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArguments(argv) {
  let mode = '';
  let revision = '';

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--dry-run' || argument === '--deploy') {
      if (mode) fail('Choose exactly one of --dry-run or --deploy');
      mode = argument;
      continue;
    }
    if (argument === '--revision') {
      revision = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    fail('Unknown Wayfinder preview argument');
  }

  if (!mode) fail('Choose exactly one of --dry-run or --deploy');
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    fail('--revision requires the exact 40-character commit');
  }
  return { mode, revision };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) fail(`${command} could not start`);
  if (result.status !== 0) {
    if (options.capture && result.stderr) process.stderr.write(result.stderr);
    fail(`${command} failed with status ${result.status ?? 'unknown'}`);
  }
  return options.capture ? result.stdout.trim() : '';
}

const args = parseArguments(process.argv.slice(2));
const startedAt = new Date();
const { previewWorker, previewOrigin, assetsOrigin } = readPreviewTopology();
const headRevision = run('git', ['rev-parse', 'HEAD'], { capture: true });
if (headRevision !== args.revision) {
  fail('--revision must equal the checked-out HEAD commit');
}
function requireCleanWorktree() {
  const shortStatus = run('git', ['status', '--short'], { capture: true });
  if (shortStatus) {
    fail('Wayfinder preview commands require a clean working tree');
  }
}
requireCleanWorktree();

const previewEnv = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: '1',
  NEXT_PUBLIC_ASSETS_BASE_URL: assetsOrigin,
  NEXT_PUBLIC_SITE_URL: previewOrigin,
};

process.stdout.write(
  `Preparing ${previewWorker} at revision ${args.revision} (${args.mode === '--dry-run' ? 'dry run' : 'deploy'})\n`,
);
run('pnpm', ['cf:build'], { cwd: appRoot, env: previewEnv });
requireCleanWorktree();

const wranglerArgs = [
  'exec',
  'wrangler',
  'deploy',
  '--env',
  previewEnvironment,
  '--var',
  `TOOLS_SERP_DEPLOYED_REVISION:${args.revision}`,
];
if (args.mode === '--dry-run') wranglerArgs.push('--dry-run');
run('pnpm', wranglerArgs, { cwd: appRoot, env: previewEnv });

const completedAt = new Date();
const evidenceRepositoryRoot =
  process.env.NODE_ENV === 'test' && process.env.TOOLS_SERP_TEST_REPOSITORY_ROOT
    ? path.resolve(process.env.TOOLS_SERP_TEST_REPOSITORY_ROOT)
    : repositoryRoot;
const evidence = recordRunEvidence({
  repositoryRoot: evidenceRepositoryRoot,
  command:
    args.mode === '--dry-run'
      ? 'prepare:cloudflare:wayfinder-preview'
      : 'deploy:cloudflare:wayfinder-preview',
  commandVersion: '1',
  revision: args.revision,
  environment: args.mode === '--dry-run' ? 'local' : 'pull-request',
  scope: 'cloudflare-wayfinder-preview',
  status: 'success',
  startedAt: startedAt.toISOString(),
  completedAt: completedAt.toISOString(),
  linkedWork: ['#77', '#107'],
  summary: {
    status: 'success',
    checksPassed: 2,
    checksFailed: 0,
    items: 2,
    durationMs: completedAt.valueOf() - startedAt.valueOf(),
  },
});
process.stdout.write(`Structured artifact: ${evidence.runId}\n`);
