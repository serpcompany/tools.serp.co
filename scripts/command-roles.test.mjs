import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const rootPackage = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const toolsPackage = JSON.parse(
  readFileSync(new URL('../apps/tools/package.json', import.meta.url), 'utf8'),
);
const wranglerConfig = JSON.parse(
  readFileSync(
    new URL('../apps/tools/wrangler.jsonc', import.meta.url),
    'utf8',
  ),
);

test('Wayfinder preview is an isolated workers.dev environment', () => {
  const preview = wranglerConfig.env?.['wayfinder-preview'];

  assert.equal(preview?.name, 'tools-serp-co-wayfinder-preview');
  assert.equal(preview?.workers_dev, true);
  assert.deepEqual(preview?.routes, []);
  assert.deepEqual(preview?.vars, {
    NEXT_PUBLIC_ASSETS_BASE_URL: 'https://assets.tools.serp.co',
    NEXT_PUBLIC_SITE_URL:
      'https://tools-serp-co-wayfinder-preview.serpcompany.workers.dev',
  });
  assert.deepEqual(preview?.assets, {
    directory: '.open-next/assets',
    binding: 'ASSETS',
  });
  assert.deepEqual(preview?.r2_buckets, [
    {
      binding: 'NEXT_INC_CACHE_R2_BUCKET',
      bucket_name: 'tools-serp-co-inc-cache-preview',
    },
  ]);
  assert.deepEqual(preview?.d1_databases, [
    {
      binding: 'SERP_TOOLS_DB',
      database_name: 'serp-tools-preview',
      database_id: '69ab9290-579f-4537-96a0-7d0dc3bede2f',
      migrations_dir: 'migrations',
    },
  ]);
  assert.deepEqual(preview?.services, [
    {
      binding: 'WORKER_SELF_REFERENCE',
      service: 'tools-serp-co-wayfinder-preview',
    },
  ]);

  assert.equal(wranglerConfig.name, 'tools-serp-co');
  assert.deepEqual(wranglerConfig.routes, [
    { pattern: 'tools.serp.co', custom_domain: true },
  ]);
  assert.equal(
    wranglerConfig.d1_databases[0].database_id,
    'da3d6222-cf0f-41fd-a8fb-4dc3e7d890db',
  );
  assert.equal(
    wranglerConfig.r2_buckets[0].bucket_name,
    'tools-serp-co-inc-cache',
  );
  assert.equal(wranglerConfig.services[0].service, 'tools-serp-co');
});

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
    rootPackage.scripts['prepare:cloudflare:wayfinder-preview'],
    'pnpm -C apps/tools prepare:cloudflare:wayfinder-preview',
  );
  assert.equal(
    rootPackage.scripts['deploy:cloudflare:wayfinder-preview'],
    'pnpm -C apps/tools deploy:cloudflare:wayfinder-preview',
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
    toolsPackage.scripts['prepare:cloudflare:wayfinder-preview'],
    'node scripts/deploy-cloudflare-wayfinder-preview.mjs --dry-run',
  );
  assert.equal(
    toolsPackage.scripts['deploy:cloudflare:wayfinder-preview'],
    'node scripts/deploy-cloudflare-wayfinder-preview.mjs --deploy',
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
    'pnpm prepare:cloudflare:wayfinder-preview',
    'deploy:cloudflare:wayfinder-preview',
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
  assert.match(runbook, /tools-serp-co-wayfinder-preview/);
  assert.match(runbook, /workers\.dev only/i);
  assert.match(runbook, /exact 40-character commit/i);
  assert.match(
    runbook,
    /deploy:cloudflare:wayfinder-preview[^\n]*ignored structured run evidence/,
  );
});
