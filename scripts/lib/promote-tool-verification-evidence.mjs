import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { toolJourneys } from '../../apps/tools/lib/tool-journeys.ts';
import {
  buildToolVerificationEvidenceIndex,
  getToolVerificationInputRevisions,
  ingestToolVerificationRun,
} from '../../apps/tools/lib/tool-verification-evidence.ts';

export function promoteToolVerificationRun({ repositoryRoot, runId }) {
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
  if (manifest.revision?.dirty !== false) {
    throw new TypeError('Dirty browser evidence cannot be promoted.');
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
    schemaVersion: manifest.schemaVersion,
    runId: manifest.runId,
    command: manifest.command,
    revision: manifest.revision,
    timestamps: manifest.timestamps,
    environment: manifest.environment,
    scope: {
      label: manifest.scope.label,
      inputHashes: manifest.scope.inputHashes ?? [],
      tools: manifest.scope.tools ?? [],
    },
    result: manifest.result,
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
