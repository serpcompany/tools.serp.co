import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const JOURNEY_ID = 'png-to-webp:upload';
const FIXTURE = 'apps/tools/benchmarks/fixtures/sample.png';
const GENERATED = 'apps/tools/lib/tool-verification-inputs.generated.json';

export function scrubGitEnvironment(environment = process.env) {
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) => !key.startsWith('GIT_')),
  );
}

function run(command, arguments_, options = {}) {
  return execFileSync(command, arguments_, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: scrubGitEnvironment({ ...process.env, ...options.env }),
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function git(cwd, ...arguments_) {
  return run('git', arguments_, { cwd });
}

function projectionScript() {
  return `
    import { readFileSync } from 'node:fs';
    import { pathToFileURL } from 'node:url';
    const root = process.argv[1];
    const manifestPath = process.argv[2] || '';
    const moduleUrl = pathToFileURL(root + '/apps/tools/lib/tool-verification-evidence.ts').href;
    const journeysUrl = pathToFileURL(root + '/apps/tools/lib/tool-journeys.ts').href;
    const evidence = await import(moduleUrl);
    const { toolJourneys } = await import(journeysUrl);
    const journey = toolJourneys.all.find((item) => item.id === '${JOURNEY_ID}');
    if (!journey) throw new Error('Golden PNG journey is missing.');
    if (!manifestPath) {
      const view = evidence.retainedToolVerificationEvidence.getForJourney(journey.id);
      process.stdout.write(JSON.stringify({ state: view.state, runId: view.latest?.runId ?? null }));
    } else {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const records = evidence.ingestToolVerificationRun(manifest);
      const index = evidence.buildToolVerificationEvidenceIndex({
        journeys: [journey], records,
        currentInputRevisions: evidence.getToolVerificationInputRevisions,
      });
      const view = index.getForJourney(journey.id);
      process.stdout.write(JSON.stringify({ state: view.state, runId: view.latest?.runId ?? null }));
    }
  `;
}

function project(repositoryRoot, manifestPath = '') {
  return JSON.parse(
    run(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '--eval',
        projectionScript(),
        repositoryRoot,
        manifestPath,
      ],
      { cwd: repositoryRoot },
    ),
  );
}

function linkDependencies(sourceRoot, cloneRoot) {
  for (const relative of ['node_modules', 'apps/tools/node_modules']) {
    const source = path.join(sourceRoot, relative);
    const target = path.join(cloneRoot, relative);
    symlinkSync(source, target, 'dir');
  }
}

function defaultBrowserRun({ cloneRoot, revision, baseUrl, environment }) {
  const output = run(
    process.execPath,
    [
      'scripts/run-browser-check.mjs',
      '--mode',
      'smoke',
      '--environment',
      'preview',
      '--revision',
      revision,
      '--base-url',
      baseUrl,
    ],
    {
      cwd: cloneRoot,
      env: { TOOLS_ONLY: 'png-to-webp', ...environment },
    },
  );
  const match = /Structured artifact: ([A-Za-z0-9._-]+)/.exec(output);
  if (!match) throw new Error('Preview browser run omitted its artifact id.');
  return path.join(cloneRoot, '.artifacts', 'runs', match[1], 'manifest.json');
}

function failClosed(manifest, cloneRoot) {
  const cases = {
    warned: { outcome: 'warned', reasonCode: 'controlled-warning' },
    skipped: { outcome: 'skipped', reasonCode: 'controlled-skip' },
    missingCheck: { outcome: 'passed', remove: 'semantic-output' },
    semanticFailure: {
      outcome: 'failed',
      reasonCode: 'semantic-output-mismatch',
    },
  };
  return Object.fromEntries(
    Object.entries(cases).map(([name, change]) => {
      const candidate = structuredClone(manifest);
      candidate.runId = `${manifest.runId}-${name}`;
      const journey = candidate.scope.tools
        .flatMap((tool) => tool.journeys)
        .find((item) => item.journeyId === JOURNEY_ID);
      journey.outcome = change.outcome;
      journey.reasonCode = change.reasonCode ?? null;
      if (change.remove) {
        journey.checks = journey.checks.filter(
          (check) => check !== change.remove,
        );
      }
      const file = path.join(cloneRoot, `.golden-${name}.json`);
      requireWriteJson(file, candidate);
      const result = project(cloneRoot, file);
      rmSync(file, { force: true });
      return [name, result.state];
    }),
  );
}

function requireWriteJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function exactPngJourney(manifest, revision) {
  if (
    manifest.schemaVersion !== 2 ||
    manifest.command?.name !== 'smoke:tools:browser' ||
    manifest.revision?.commit !== revision ||
    manifest.revision?.dirty !== false ||
    manifest.environment !== 'pull-request' ||
    manifest.result?.status !== 'success'
  ) {
    throw new Error('Preview rerun manifest identity is not exact and clean.');
  }
  const tools = manifest.scope?.tools ?? [];
  const journeys = tools.flatMap((tool) => tool.journeys ?? []);
  if (
    tools.length !== 1 ||
    tools[0]?.toolId !== 'png-to-webp' ||
    journeys.length !== 1 ||
    journeys[0]?.journeyId !== JOURNEY_ID ||
    journeys[0]?.outcome !== 'passed' ||
    !journeys[0]?.checks?.includes('semantic-output')
  ) {
    throw new Error(
      'Preview rerun did not contain the exact passed PNG journey.',
    );
  }
  return journeys[0];
}

export async function proveGoldenCurrentnessPreview(options) {
  const { repositoryRoot, revision, baseUrl } = options;
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw new TypeError('revision must be a full commit SHA');
  }
  const origin = new URL(baseUrl);
  if (
    origin.protocol !== 'https:' ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !origin.hostname.includes('preview') ||
    ['localhost', '127.0.0.1', '::1'].includes(origin.hostname)
  ) {
    throw new TypeError(
      'baseUrl must be an exact HTTPS origin explicitly named preview',
    );
  }
  if (git(repositoryRoot, 'rev-parse', 'HEAD') !== revision) {
    throw new Error('Supplied revision must equal repository HEAD.');
  }
  if (git(repositoryRoot, 'status', '--porcelain', '--untracked-files=all')) {
    throw new Error('Preview currentness proof requires a clean repository.');
  }

  const scratch = mkdtempSync(
    path.join(os.tmpdir(), 'golden-preview-currentness-'),
  );
  const cloneRoot = path.join(scratch, 'worktree');
  const branch = `golden-currentness-proof-${revision.slice(0, 7)}`;
  try {
    run('git', [
      'clone',
      '--quiet',
      '--no-local',
      '--no-checkout',
      repositoryRoot,
      cloneRoot,
    ]);
    git(cloneRoot, 'switch', '--detach', revision);
    linkDependencies(repositoryRoot, cloneRoot);
    const prior = project(cloneRoot);
    if (
      !prior.runId ||
      prior.state === 'stale' ||
      prior.state === 'no-evidence'
    ) {
      throw new Error(
        'Prior retained PNG evidence is not current enough to test.',
      );
    }

    git(cloneRoot, 'switch', '-c', branch);
    const fixturePath = path.join(cloneRoot, FIXTURE);
    const originalFixture = readFileSync(fixturePath);
    writeFileSync(
      fixturePath,
      Buffer.concat([originalFixture, Buffer.from([0])]),
    );
    run(
      process.execPath,
      [
        '--experimental-strip-types',
        'scripts/generate-tool-verification-inputs.mjs',
      ],
      { cwd: cloneRoot },
    );
    git(cloneRoot, 'add', FIXTURE, GENERATED);
    git(
      cloneRoot,
      '-c',
      'user.name=Golden Currentness Proof',
      '-c',
      'user.email=golden@invalid.example',
      'commit',
      '-m',
      'test: mutate golden fixture',
    );
    const mutationCommit = git(cloneRoot, 'rev-parse', 'HEAD');
    const stale = project(cloneRoot);
    if (stale.state !== 'stale' || stale.runId !== prior.runId) {
      throw new Error('Prior retained evidence did not become stale.');
    }

    git(cloneRoot, 'switch', '--detach', revision);
    if (git(cloneRoot, 'status', '--porcelain', '--untracked-files=all')) {
      throw new Error('Baseline worktree was not restored cleanly.');
    }
    const manifestPath = await (options.browserRun ?? defaultBrowserRun)({
      cloneRoot,
      revision,
      baseUrl,
      environment: options.environment ?? {},
    });
    const actualManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const actualJourney = exactPngJourney(actualManifest, revision);
    const current = project(cloneRoot, manifestPath);
    if (current.state !== 'verified') {
      throw new Error(
        `Actual preview rerun projected ${current.state}, not verified.`,
      );
    }
    const closed = failClosed(actualManifest, cloneRoot);
    const expected = {
      warned: 'warned',
      skipped: 'skipped',
      missingCheck: 'incomplete',
      semanticFailure: 'failed',
    };
    if (JSON.stringify(closed) !== JSON.stringify(expected)) {
      throw new Error('Fail-closed preview evidence projection did not match.');
    }
    return {
      revision,
      target: origin.origin,
      isolation: {
        kind: 'disposable-clone-branch',
        branch,
        baselineCommit: revision,
        mutationCommit,
        restorationMechanism: 'switch-detach-exact-baseline',
        restoredCommit: git(cloneRoot, 'rev-parse', 'HEAD'),
      },
      prior,
      mutated: stale,
      restored: {
        cleanRevision: revision,
        actualRunId: current.runId,
        state: current.state,
        actualEvidence: {
          outcome: actualJourney.outcome,
          checks: actualJourney.checks,
          inputRevisions: actualJourney.inputRevisions,
        },
      },
      failClosed: closed,
      productionTouched: false,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
