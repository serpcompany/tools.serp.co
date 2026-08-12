import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const turboConfig = JSON.parse(
  readFileSync(new URL('../turbo.json', import.meta.url), 'utf8'),
);
const rootTypeScriptConfig = JSON.parse(
  readFileSync(new URL('../tsconfig.json', import.meta.url), 'utf8'),
);
const preCommitHook = readFileSync(
  new URL('../.githooks/pre-commit', import.meta.url),
  'utf8',
);
const prePushHook = readFileSync(
  new URL('../.githooks/pre-push', import.meta.url),
  'utf8',
);
const cloudflareBuild = readFileSync(
  new URL('../apps/tools/scripts/build-cloudflare.mjs', import.meta.url),
  'utf8',
);

test('root check is the deterministic production-faithful verification seam', () => {
  assert.equal(packageJson.scripts.build, 'pnpm -C apps/tools cf:build');
  assert.equal(
    packageJson.scripts.lint,
    'TURBO_TELEMETRY_DISABLED=1 turbo lint --cache=local:rw --no-daemon',
  );
  assert.equal(
    packageJson.scripts.typecheck,
    'TURBO_TELEMETRY_DISABLED=1 turbo typecheck --cache=local:rw --no-daemon',
  );
  assert.equal(
    packageJson.scripts['verify:catalog'],
    'node scripts/validate-tools.mjs',
  );
  assert.deepEqual(
    packageJson.scripts.check.split('&&').map((command) => command.trim()),
    [
      'pnpm lint',
      'pnpm typecheck',
      'pnpm test',
      'pnpm verify:agent-workflow',
      'pnpm verify:workflow-ownership',
      'pnpm verify:docs',
      'pnpm verify:catalog',
      'pnpm build',
    ],
  );
  assert.equal(
    packageJson.scripts['verify:workflow-ownership'],
    'node scripts/verify-tool-workflow-ownership.mjs',
  );
  assert.doesNotMatch(
    packageJson.scripts.check,
    /link|canary|smoke|benchmark|sync|upload|deploy|migrat|wrangler|remote/i,
  );
  assert.equal(
    packageJson.scripts['check:links'],
    'node scripts/validate-lander-outbound-links.mjs',
  );
  assert.equal(packageJson.scripts['lint:tools'], undefined);
  assert.equal(packageJson.scripts['lint:links'], undefined);
  assert.deepEqual(turboConfig.tasks.typecheck, {
    dependsOn: ['^typecheck'],
  });
  assert.equal(turboConfig.tasks['check-types'], undefined);
  assert.equal(
    rootTypeScriptConfig.extends,
    '@serp-tools/typescript-config/base.json',
  );
  assert.match(preCommitHook, /pnpm check:links/);
});

test('production build avoids implicit build-time network activity', () => {
  const layout = readFileSync(
    new URL(
      '../packages/app-core/src/components/app-layout.tsx',
      import.meta.url,
    ),
    'utf8',
  );

  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.match(layout, /bg-background font-sans antialiased/);
  assert.match(cloudflareBuild, /NEXT_TELEMETRY_DISABLED:\s*["']1["']/);
});

test('pre-push uses the canonical deterministic check', () => {
  assert.match(prePushHook, /pnpm check/);
  assert.doesNotMatch(prePushHook, /lint:tools|lint:links/);
});
