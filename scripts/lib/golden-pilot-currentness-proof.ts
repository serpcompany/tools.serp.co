import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { toolJourneys } from '../../apps/tools/lib/tool-journeys.ts';
import {
  buildToolVerificationEvidenceIndex,
  getRequiredVerificationChecks,
  getToolVerificationInputRevisions,
  ingestToolVerificationRun,
  type ToolJourneyEvidenceOutcome,
  type ToolVerificationCheck,
  type ToolVerificationRunManifest,
} from '../../apps/tools/lib/tool-verification-evidence.ts';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const generatedInputsPath = fileURLToPath(
  new URL(
    '../../apps/tools/lib/tool-verification-inputs.generated.json',
    import.meta.url,
  ),
);

function freeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function digest(value: string | Buffer) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function fixtureRevisionFromGeneratedFile(file: string, journeyId: string) {
  const generated = JSON.parse(readFileSync(file, 'utf8')) as {
    fixtureSha256ByJourney?: Record<string, string>;
  };
  const fixtureSha256 = generated.fixtureSha256ByJourney?.[journeyId];
  if (!fixtureSha256 || !/^[a-f0-9]{64}$/.test(fixtureSha256)) {
    throw new TypeError(
      `Generated verification inputs omit ${journeyId} fixture content.`,
    );
  }
  return `sha256:${fixtureSha256}`;
}

function isolatedGitEnvironment(
  environment: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const sanitizedEnvironment: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(sanitizedEnvironment)) {
    if (name.startsWith('GIT_')) delete sanitizedEnvironment[name];
  }
  return { ...sanitizedEnvironment, ...environment };
}

function git(
  workingDirectory: string,
  arguments_: readonly string[],
  environment: Readonly<Record<string, string>> = {},
) {
  return execFileSync('git', [...arguments_], {
    cwd: workingDirectory,
    encoding: 'utf8',
    env: isolatedGitEnvironment(environment),
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function commitIsolatedChange(workingDirectory: string, message: string) {
  git(workingDirectory, ['add', 'tool-verification-inputs.generated.json']);
  git(workingDirectory, ['commit', '-m', message], {
    GIT_AUTHOR_DATE: '2026-08-13T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-08-13T00:00:00Z',
  });
  return git(workingDirectory, ['rev-parse', 'HEAD']);
}

function manifest(options: {
  runId: string;
  revision: string;
  journeyId: string;
  toolId: string;
  fixtureReference: string;
  fixtureSha256: string;
  invariantId: string;
  inputRevisions: Readonly<Record<string, string>>;
  outcome: ToolJourneyEvidenceOutcome;
  reasonCode: string | null;
  checks: readonly ToolVerificationCheck[];
}): ToolVerificationRunManifest {
  return freeze({
    schemaVersion: 2,
    runId: options.runId,
    revision: { commit: options.revision, dirty: false },
    timestamps: {
      startedAt: '2026-08-13T00:00:00.000Z',
      completedAt: '2026-08-13T00:00:01.000Z',
    },
    environment: 'pull-request',
    scope: {
      label: 'golden-currentness-mechanical-proof',
      inputHashes: [],
      tools: [
        {
          toolId: options.toolId,
          journeys: [
            {
              journeyId: options.journeyId,
              outcome: options.outcome,
              reasonCode: options.reasonCode,
              fixture: {
                kind: 'content',
                reference: options.fixtureReference,
                sha256: options.fixtureSha256,
              },
              invariantId: options.invariantId,
              checks: options.checks,
              inputRevisions: options.inputRevisions,
            },
          ],
        },
      ],
    },
    result: { status: 'success' },
  });
}

export function proveGoldenPilotEvidenceCurrentness() {
  const journey = toolJourneys
    .getByToolId('png-to-webp')
    .find((candidate) => candidate.id === 'png-to-webp:upload');
  if (!journey) throw new TypeError('Golden currentness journey is missing.');

  const originalGeneratedInputs = readFileSync(generatedInputsPath);
  const isolatedRoot = mkdtempSync(
    path.join(tmpdir(), 'tools-serp-golden-currentness-'),
  );
  const isolatedGeneratedInputs = path.join(
    isolatedRoot,
    'tool-verification-inputs.generated.json',
  );
  writeFileSync(isolatedGeneratedInputs, originalGeneratedInputs);

  try {
    git(isolatedRoot, ['init', '-b', 'golden-currentness-baseline']);
    git(isolatedRoot, ['config', 'user.name', 'Golden Currentness Proof']);
    git(isolatedRoot, [
      'config',
      'user.email',
      'golden-currentness-proof@invalid.example',
    ]);
    const baselineCommit = commitIsolatedChange(
      isolatedRoot,
      'baseline generated verification inputs',
    );
    const proofBranch = 'golden-currentness-proof';
    git(isolatedRoot, ['switch', '-c', proofBranch]);
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: isolatedGitEnvironment(),
    }).trim();
    if (!/^[a-f0-9]{40}$/.test(revision)) {
      throw new TypeError('Golden currentness proof requires a Git revision.');
    }
    const current = getToolVerificationInputRevisions(journey);
    const fixtureContent = fixtureRevisionFromGeneratedFile(
      isolatedGeneratedInputs,
      journey.id,
    );
    const fixtureReference = journey.fixture.reference;
    const invariantId = journey.semanticInvariant.id;
    if (
      fixtureContent !== current['fixture-content'] ||
      !fixtureReference ||
      !invariantId
    ) {
      throw new TypeError(
        'Isolated generated inputs do not match the checkout.',
      );
    }
    const fixtureSha256 = fixtureContent.slice('sha256:'.length);
    const requiredChecks = getRequiredVerificationChecks(journey);
    const makeManifest = (
      runId: string,
      outcome: ToolJourneyEvidenceOutcome,
      reasonCode: string | null,
      checks: readonly ToolVerificationCheck[] = requiredChecks,
      inputRevisions: Readonly<Record<string, string>> = current,
    ) =>
      manifest({
        runId,
        revision,
        journeyId: journey.id,
        toolId: journey.toolId,
        fixtureReference,
        fixtureSha256,
        invariantId,
        inputRevisions,
        outcome,
        reasonCode,
        checks,
      });
    const state = (
      evidenceManifest: ToolVerificationRunManifest,
      currentInputs: Readonly<Record<string, string>>,
    ) =>
      buildToolVerificationEvidenceIndex({
        journeys: [journey],
        records: ingestToolVerificationRun(evidenceManifest),
        currentInputRevisions: () => currentInputs,
      }).getForJourney(journey.id).state;

    const beforeManifest = makeManifest(
      'golden-currentness-before',
      'passed',
      null,
    );
    const beforeState = state(beforeManifest, current);

    const mutated = JSON.parse(originalGeneratedInputs.toString('utf8')) as {
      fixtureSha256ByJourney: Record<string, string>;
    };
    mutated.fixtureSha256ByJourney[journey.id] = '0'.repeat(64);
    writeFileSync(
      isolatedGeneratedInputs,
      `${JSON.stringify(mutated, null, 2)}\n`,
    );
    const mutatedFileDigest = digest(readFileSync(isolatedGeneratedInputs));
    const mutationCommit = commitIsolatedChange(
      isolatedRoot,
      'mutate generated fixture input',
    );
    const changedInputs = freeze({
      ...current,
      'fixture-content': fixtureRevisionFromGeneratedFile(
        isolatedGeneratedInputs,
        journey.id,
      ),
    });
    const staleState = state(beforeManifest, changedInputs);

    writeFileSync(isolatedGeneratedInputs, originalGeneratedInputs);
    const restorationCommit = commitIsolatedChange(
      isolatedRoot,
      'restore generated fixture input',
    );
    const restoredInputs = freeze({
      ...current,
      'fixture-content': fixtureRevisionFromGeneratedFile(
        isolatedGeneratedInputs,
        journey.id,
      ),
    });
    if (
      readFileSync(isolatedGeneratedInputs).compare(originalGeneratedInputs)
    ) {
      throw new Error(
        'Generated verification inputs were not restored exactly.',
      );
    }
    const rerunManifest = makeManifest(
      'golden-currentness-rerun',
      'passed',
      null,
      requiredChecks,
      restoredInputs,
    );
    const restoredState = state(rerunManifest, restoredInputs);

    const missingChecks = requiredChecks.filter(
      (check) => check !== 'cancellation-lifecycle',
    );
    const failClosedManifests = {
      warned: makeManifest(
        'golden-fail-closed-warned',
        'warned',
        'controlled-warning',
      ),
      skipped: makeManifest(
        'golden-fail-closed-skipped',
        'skipped',
        'controlled-skip',
      ),
      missingCheck: makeManifest(
        'golden-fail-closed-missing-check',
        'passed',
        null,
        missingChecks,
      ),
      semanticFailure: makeManifest(
        'golden-fail-closed-semantic-failure',
        'failed',
        'semantic-output-mismatch',
      ),
    };

    return freeze({
      journeyId: journey.id,
      changedInput: 'fixture-content' as const,
      mechanism: {
        evidencePath: 'manifest ingestion -> production evidence projection',
        isolation: {
          kind: 'disposable-git-branch',
          branch: git(isolatedRoot, ['branch', '--show-current']),
          baselineCommit,
          mutationCommit,
          restorationCommit,
          worktreeClean:
            git(isolatedRoot, ['status', '--porcelain']).length === 0,
        },
        isolatedGeneratedInput: path.basename(isolatedGeneratedInputs),
        originalFileDigest: digest(originalGeneratedInputs),
        mutatedFileDigest,
        beforeRunId: beforeManifest.runId,
        rerunRunId: rerunManifest.runId,
        restorationExact: true,
        observedFixtureRevisions: {
          before: current['fixture-content'],
          mutated: changedInputs['fixture-content'],
          restored: restoredInputs['fixture-content'],
        },
      },
      transitions: [
        { step: 'current-before-change' as const, state: beforeState },
        { step: 'fixture-changed' as const, state: staleState },
        { step: 'restored-and-rerun' as const, state: restoredState },
      ],
      failClosed: {
        warned: state(failClosedManifests.warned, restoredInputs),
        skipped: state(failClosedManifests.skipped, restoredInputs),
        missingCheck: state(failClosedManifests.missingCheck, restoredInputs),
        semanticFailure: state(
          failClosedManifests.semanticFailure,
          restoredInputs,
        ),
      },
      failClosedRunIds: Object.fromEntries(
        Object.entries(failClosedManifests).map(([key, value]) => [
          key,
          value.runId,
        ]),
      ),
      failClosedEvidence: Object.fromEntries(
        Object.entries(failClosedManifests).map(([key, value]) => {
          const projectedState = state(value, restoredInputs);
          const evidence = ingestToolVerificationRun(value)[0];
          return [
            key,
            {
              runId: value.runId,
              outcome: evidence?.outcome,
              reasonCode: evidence?.reasonCode,
              retainedCheckCount: evidence?.checks.length,
              projectedState,
              appearsVerified: projectedState === 'verified',
            },
          ];
        }),
      ),
    });
  } finally {
    rmSync(isolatedRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(
    `${JSON.stringify(proveGoldenPilotEvidenceCurrentness())}\n`,
  );
}
