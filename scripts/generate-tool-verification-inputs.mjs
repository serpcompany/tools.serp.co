import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { toolJourneys } from '../apps/tools/lib/tool-journeys.ts';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const outputPath = path.join(
  repositoryRoot,
  'apps/tools/lib/tool-verification-inputs.generated.json',
);
const NON_EXECUTABLE_PROJECTION_FILES = new Set([
  'apps/tools/lib/tool-acceptance-claims.ts',
  'apps/tools/lib/tool-factory-read-model.ts',
]);

export function isToolExecutableVerificationInput(file) {
  return !NON_EXECUTABLE_PROJECTION_FILES.has(file);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function trackedFiles(patterns) {
  return execFileSync('git', ['ls-files', '--', ...patterns], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(
      (file) =>
        file &&
        !file.endsWith('.test.ts') &&
        !file.endsWith('.test.mjs') &&
        !file.endsWith('.generated.json'),
    )
    .sort();
}

function hashFiles(files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(path.join(repositoryRoot, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

const fixtureRoot = path.join(repositoryRoot, 'apps/tools/benchmarks');
const matrix = JSON.parse(
  readFileSync(path.join(fixtureRoot, 'fixture-matrix.json'), 'utf8'),
);
const formats = new Map(matrix.formats.map((entry) => [entry.format, entry]));

function fixtureDigest(journey) {
  const { kind, reference } = journey.fixture;
  if (!reference) return null;
  if (kind === 'literal' || kind === 'maintainer-url') {
    return sha256(reference);
  }
  let fixtureReference = reference;
  if (reference.startsWith('formats/')) {
    fixtureReference = formats.get(reference.slice('formats/'.length))?.fixture;
  } else if (reference.startsWith('tools/')) {
    const fixture = matrix.toolFixtures?.[journey.toolId] ?? {};
    fixtureReference = fixture.fixture ?? fixture.responseFixture;
    if (!fixtureReference && typeof fixture.fixtureText === 'string') {
      return sha256(fixture.fixtureText);
    }
    if (!fixtureReference) return sha256(JSON.stringify(fixture));
  }
  if (!fixtureReference) return null;
  return sha256(readFileSync(path.join(fixtureRoot, fixtureReference)));
}

export function buildToolVerificationInputs() {
  const executableFiles = trackedFiles([
    'apps/tools/app',
    'apps/tools/next.config.mjs',
    'apps/tools/open-next.config.ts',
    'apps/tools/package.json',
    'apps/tools/wrangler.jsonc',
    'apps/tools/lib',
    'apps/tools/components',
    'apps/tools/workers',
    'apps/tools/public',
    'packages/app-core/src',
    'packages/tool-telemetry/src',
    'packages/ui/src',
    'packages/app-core/package.json',
    'packages/tool-telemetry/package.json',
    'packages/ui/package.json',
    'package.json',
  ]).filter(isToolExecutableVerificationInput);
  const runnerFiles = trackedFiles([
    'scripts/run-browser-check.mjs',
    'scripts/run-artifacts.mjs',
    'scripts/lib/browser-evidence.mjs',
    'scripts/lib/generic-smoke-capabilities.mjs',
    'scripts/lib/run-evidence.mjs',
    'scripts/lib/svg-compression-browser-proof.mjs',
    'scripts/lib/svg-render-equivalence.mjs',
    'scripts/lib/transcription-browser-state.mjs',
  ]);
  return {
    schemaVersion: 1,
    executableSources: `sha256:${hashFiles(executableFiles)}`,
    dependencyLock: `sha256:${sha256(readFileSync(path.join(repositoryRoot, 'pnpm-lock.yaml')))}`,
    runnerSources: `sha256:${hashFiles(runnerFiles)}`,
    fixtureSha256ByJourney: Object.fromEntries(
      toolJourneys.all.map((journey) => [journey.id, fixtureDigest(journey)]),
    ),
  };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const generated = `${JSON.stringify(buildToolVerificationInputs(), null, 2)}\n`;
  if (process.argv.includes('--check')) {
    if (readFileSync(outputPath, 'utf8') !== generated) {
      throw new Error(
        'Tool verification inputs are stale; run pnpm generate:tool-verification-inputs.',
      );
    }
  } else {
    writeFileSync(outputPath, generated);
  }
}
