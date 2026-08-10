import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const rootPackage = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const toolsPackage = JSON.parse(
  readFileSync(new URL('../apps/tools/package.json', import.meta.url), 'utf8'),
);

test('development, preview, canary, browser, and production commands name their roles', () => {
  assert.equal(
    rootPackage.scripts['dev:local'],
    'pnpm -C apps/tools dev:local',
  );
  assert.equal(
    rootPackage.scripts['preview:cloudflare:local'],
    'pnpm -C apps/tools preview:cloudflare:local',
  );
  assert.equal(
    rootPackage.scripts['canary:cloudflare:deployed'],
    'pnpm -C apps/tools canary:cloudflare:deployed',
  );
  assert.equal(
    rootPackage.scripts['smoke:tools:browser'],
    'node scripts/run-browser-check.mjs --mode smoke',
  );
  assert.equal(
    rootPackage.scripts['benchmark:tools:browser'],
    'node scripts/run-browser-check.mjs --mode benchmark',
  );
  assert.equal(rootPackage.scripts.dev, undefined);
  assert.equal(rootPackage.scripts['benchmark:tools'], undefined);

  assert.equal(toolsPackage.scripts['dev:local'], 'node scripts/dev.mjs');
  assert.equal(
    toolsPackage.scripts['preview:cloudflare:local'],
    'pnpm cf:build && wrangler dev --local',
  );
  assert.equal(
    toolsPackage.scripts['canary:cloudflare:deployed'],
    'node scripts/canary-cloudflare-deployed.mjs',
  );
  assert.equal(
    toolsPackage.scripts['deploy:cloudflare:production'],
    'pnpm cf:build && wrangler deploy',
  );
  assert.equal(toolsPackage.scripts.dev, undefined);
  assert.equal(toolsPackage.scripts['cf:preview'], undefined);
  assert.equal(toolsPackage.scripts['cf:deploy'], undefined);
  assert.equal(toolsPackage.scripts['audit:cf:api-smoke'], undefined);
  assert.equal(toolsPackage.scripts.start, undefined);
});

test('data and asset mutations name target and remote behavior', () => {
  assert.equal(
    toolsPackage.scripts['provision:d1:preview'],
    'wrangler d1 create serp-tools-preview --binding SERP_TOOLS_DB',
  );
  assert.equal(
    toolsPackage.scripts['provision:d1:production'],
    'wrangler d1 create serp-tools-prod --binding SERP_TOOLS_DB',
  );
  assert.equal(
    toolsPackage.scripts['migrate:d1:local'],
    'wrangler d1 migrations apply SERP_TOOLS_DB --local',
  );
  assert.equal(
    toolsPackage.scripts['migrate:d1:preview:remote'],
    'wrangler d1 migrations apply SERP_TOOLS_DB --remote --preview',
  );
  assert.equal(
    toolsPackage.scripts['migrate:d1:production:remote'],
    'wrangler d1 migrations apply SERP_TOOLS_DB --remote',
  );
  assert.equal(
    toolsPackage.scripts['upload:r2:ffmpeg:production'],
    'node scripts/upload-r2-ffmpeg-assets.mjs',
  );
  assert.equal(
    toolsPackage.scripts['import:d1:local'],
    'node scripts/import-tool-runs-to-d1.mjs --local',
  );
  assert.equal(
    toolsPackage.scripts['import:d1:preview:remote'],
    'node scripts/import-tool-runs-to-d1.mjs --preview',
  );
  assert.equal(
    toolsPackage.scripts['import:d1:production:remote'],
    'node scripts/import-tool-runs-to-d1.mjs --remote',
  );
  assert.equal(
    toolsPackage.scripts['generate:cloudflare:types'],
    'wrangler types',
  );

  for (const retiredAlias of [
    'd1:create:prod',
    'd1:create:preview',
    'd1:migrate:local',
    'd1:migrate:preview',
    'd1:migrate:prod',
    'd1:import:local',
    'd1:import:preview',
    'd1:import:prod',
    'r2:upload-ffmpeg-assets',
    'cf:typegen',
  ]) {
    assert.equal(toolsPackage.scripts[retiredAlias], undefined);
  }
});

test('human-controlled and live-system roles stay outside root check', () => {
  assert.doesNotMatch(
    rootPackage.scripts.check,
    /preview|canary|smoke|benchmark|provision|migrate|upload|deploy/i,
  );
});

test('command runbook documents side effects, authority, targets, and evidence', () => {
  const runbookUrl = new URL('../docs/runbooks/commands.md', import.meta.url);
  assert.equal(existsSync(runbookUrl), true);
  const runbook = readFileSync(runbookUrl, 'utf8');

  for (const command of [
    'pnpm dev:local',
    'pnpm preview:cloudflare:local',
    'pnpm canary:cloudflare:deployed',
    'pnpm smoke:tools:browser',
    'pnpm benchmark:tools:browser',
    'deploy:cloudflare:production',
    'provision:d1:preview',
    'provision:d1:production',
    'migrate:d1:preview:remote',
    'migrate:d1:production:remote',
    'upload:r2:ffmpeg:production',
  ]) {
    assert.match(runbook, new RegExp(command.replaceAll(':', '\\:')));
  }
  assert.match(runbook, /network access/i);
  assert.match(runbook, /repository writes/i);
  assert.match(runbook, /external writes/i);
  assert.match(runbook, /human-controlled/i);
  assert.match(runbook, /structured artifact/i);
  assert.match(runbook, /safe reads by default/i);
});
