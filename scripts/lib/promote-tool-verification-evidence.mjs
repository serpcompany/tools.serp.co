import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { toolJourneys } from '../../apps/tools/lib/tool-journeys.ts';
import {
  buildToolVerificationEvidenceIndex,
  getToolVerificationInputRevisions,
  ingestToolVerificationRun,
} from '../../apps/tools/lib/tool-verification-evidence.ts';

function repositoryGitState(repositoryRoot) {
  return {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }).trim(),
    dirty:
      execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
      }).trim() !== '',
  };
}

export function promoteToolVerificationRun({
  repositoryRoot,
  runId,
  gitState = repositoryGitState(repositoryRoot),
}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) {
    throw new TypeError('Run id is invalid.');
  }
  const manifestPath = path.join(
    repositoryRoot,
    '.artifacts',
    'runs',
    runId,
    'manifest.json',
  );
  const retainedPath = path.join(
    repositoryRoot,
    'docs',
    'audits',
    'tool-verification',
    'retained-runs.json',
  );
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.runId !== runId) {
    throw new TypeError('Manifest run identity does not match its directory.');
  }
  if (manifest.command?.name !== 'smoke:tools:browser') {
    throw new TypeError('Only Tool browser smoke evidence can be promoted.');
  }
  if (
    !/^[A-Za-z0-9._-]+$/.test(String(manifest.command.version)) ||
    !/^[a-z0-9][a-z0-9._-]*$/.test(manifest.scope?.label ?? '') ||
    !(manifest.scope?.inputHashes ?? []).every((value) =>
      /^sha256:[a-f0-9]{64}$/.test(value),
    ) ||
    !new Set(['success', 'failure']).has(manifest.result?.status) ||
    !Number.isFinite(Date.parse(manifest.timestamps?.startedAt)) ||
    !Number.isFinite(Date.parse(manifest.timestamps?.completedAt))
  ) {
    throw new TypeError('Browser evidence contains invalid retained metadata.');
  }
  if (manifest.revision?.dirty !== false) {
    throw new TypeError('Dirty browser evidence cannot be promoted.');
  }
  if (gitState.dirty || gitState.revision !== manifest.revision.commit) {
    throw new TypeError(
      'Promotion requires a clean checkout at the exact evidence revision.',
    );
  }
  const records = ingestToolVerificationRun(manifest);
  buildToolVerificationEvidenceIndex({
    journeys: toolJourneys.all,
    records,
    currentInputRevisions: getToolVerificationInputRevisions,
  });
  const retained = JSON.parse(readFileSync(retainedPath, 'utf8'));
  if (!Array.isArray(retained)) {
    throw new TypeError('Retained Tool evidence must be a JSON array.');
  }
  if (retained.some((run) => run.runId === runId)) {
    throw new TypeError(`Run ${runId} is already retained.`);
  }
  const sanitized = {
    schemaVersion: 2,
    runId: manifest.runId,
    command: {
      name: 'smoke:tools:browser',
      version: String(manifest.command.version),
    },
    revision: { commit: manifest.revision.commit, dirty: false },
    timestamps: {
      startedAt: manifest.timestamps.startedAt,
      completedAt: manifest.timestamps.completedAt,
    },
    environment: manifest.environment,
    scope: {
      label: manifest.scope.label,
      inputHashes: (manifest.scope.inputHashes ?? []).map(String),
      tools: (manifest.scope.tools ?? []).map((tool) => ({
        toolId: tool.toolId,
        journeys: tool.journeys.map((journey) => ({
          journeyId: journey.journeyId,
          outcome: journey.outcome,
          reasonCode: journey.reasonCode,
          fixture: journey.fixture
            ? {
                kind: journey.fixture.kind,
                reference: journey.fixture.reference,
                sha256: journey.fixture.sha256,
              }
            : null,
          invariantId: journey.invariantId,
          checks: [...journey.checks],
          inputRevisions: Object.fromEntries(
            Object.entries(journey.inputRevisions).map(([key, value]) => [
              key,
              value,
            ]),
          ),
        })),
        ...(tool.warnings?.length ? { warnings: [...tool.warnings] } : {}),
      })),
    },
    result: { status: manifest.result.status },
  };
  const updated = [...retained, sanitized].sort((left, right) =>
    left.timestamps.completedAt.localeCompare(right.timestamps.completedAt),
  );
  writeFileSync(retainedPath, `${JSON.stringify(updated, null, 2)}\n`);
  return {
    runId,
    journeyResults: records.length,
  };
}
