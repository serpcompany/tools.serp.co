import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));
const appPackage = JSON.parse(readFileSync('apps/tools/package.json', 'utf8'));
const appCorePackage = JSON.parse(
  readFileSync('packages/app-core/package.json', 'utf8'),
);
const telemetryPackage = JSON.parse(
  readFileSync('packages/tool-telemetry/package.json', 'utf8'),
);

const RETIRED_FILES = [
  '.github/workflows/preview.yml',
  'apps/tools/scripts/audit-cloudflare-parity.mjs',
  'apps/tools/scripts/audit-cloudflare-readiness.mjs',
  'drizzle.config.ts',
  'packages/app-core/src/db/index.ts',
  'packages/app-core/src/db/schema.ts',
  'scripts/export-tools.mjs',
  'scripts/seed-tools.mjs',
];

test('legacy Vercel and Postgres repository paths are retired', () => {
  for (const retiredFile of RETIRED_FILES) {
    assert.equal(existsSync(retiredFile), false, retiredFile);
  }

  for (const packageJson of [
    rootPackage,
    appPackage,
    appCorePackage,
    telemetryPackage,
  ]) {
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    assert.equal(dependencies['drizzle-kit'], undefined);
    assert.equal(dependencies['drizzle-orm'], undefined);
    assert.equal(dependencies.postgres, undefined);
  }
  assert.equal(appCorePackage.exports['./db'], undefined);
  assert.equal(appCorePackage.exports['./db/*'], undefined);
  assert.equal(
    telemetryPackage.dependencies?.['@serp-tools/app-core'],
    undefined,
  );
  assert.equal(appPackage.scripts['audit:cf:readiness'], undefined);
  assert.equal(appPackage.scripts['audit:cf:parity'], undefined);
});

test('telemetry writes require D1 while source inspection does not invent runtime observations', () => {
  const server = readFileSync('packages/tool-telemetry/src/server.ts', 'utf8');
  const inspectionPage = readFileSync(
    'apps/tools/app/internal/tools/page.tsx',
    'utf8',
  );
  const inspectionModel = readFileSync(
    'apps/tools/lib/tool-factory-read-model.ts',
    'utf8',
  );

  for (const source of [server, inspectionPage, inspectionModel]) {
    assert.doesNotMatch(source, /DATABASE_URL/);
    assert.doesNotMatch(source, /drizzle-orm/);
    assert.doesNotMatch(source, /@serp-tools\/app-core\/db/);
  }
  assert.match(server, /D1 telemetry binding unavailable/);
  assert.match(inspectionModel, /classification: 'not-loaded'/);
  assert.match(inspectionModel, /No runtime observation source is loaded/);
  assert.doesNotMatch(inspectionPage, /LegacyDashboard/);
});

test('repository CI performs the production-faithful check without deployment credentials', () => {
  const workflowPath = '.github/workflows/check.yml';
  assert.equal(existsSync(workflowPath), true);
  const workflow = readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /pnpm exec playwright install --with-deps chromium/);
  assert.ok(
    workflow.indexOf('pnpm exec playwright install --with-deps chromium') <
      workflow.indexOf('pnpm check'),
    'CI must install the pinned browser before the production-faithful check',
  );
  assert.match(workflow, /pnpm check/);
  assert.doesNotMatch(workflow, /vercel/i);
  assert.doesNotMatch(workflow, /secrets\./);
});

test('current architecture and runbook describe the D1-only boundary and owner handoff', () => {
  const architecture = readFileSync('ARCHITECTURE.md', 'utf8');
  const runbook = readFileSync('docs/runbooks/cloudflare.md', 'utf8');
  const currentConfig = [
    readFileSync('turbo.json', 'utf8'),
    JSON.stringify(rootPackage),
    JSON.stringify(appPackage),
    JSON.stringify(appCorePackage),
    JSON.stringify(telemetryPackage),
  ].join('\n');

  assert.doesNotMatch(currentConfig, /DATABASE_URL|VERCEL_URL/);
  assert.doesNotMatch(architecture, /legacy Postgres|telemetry-to-app-core/);
  assert.match(runbook, /D1 only/i);
  assert.match(runbook, /protected export or snapshot/i);
  assert.match(runbook, /reconciliation/i);
  assert.match(runbook, /owner-controlled/i);
  assert.match(runbook, /\.vercel/);
  assert.match(runbook, /issue #67/i);
});
