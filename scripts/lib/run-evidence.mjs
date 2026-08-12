import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const artifactWriter = fileURLToPath(
  new URL('../run-artifacts.mjs', import.meta.url),
);

const summaryFields = Object.freeze({
  checksPassed: 'checks-passed',
  checksFailed: 'checks-failed',
  items: 'items',
  bytes: 'bytes',
  durationMs: 'duration-ms',
  samples: 'samples',
  minMs: 'min-ms',
  p50Ms: 'p50-ms',
  p95Ms: 'p95-ms',
  maxMs: 'max-ms',
});

function renderSummary(summary) {
  if (!new Set(['success', 'failure', 'cancelled']).has(summary.status)) {
    throw new Error('Evidence summary status is invalid');
  }
  const lines = [`status=${summary.status}`];
  for (const [field, outputName] of Object.entries(summaryFields)) {
    const value = summary[field];
    if (value === undefined) {
      continue;
    }
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(
        'Evidence summary counters must be non-negative integers',
      );
    }
    lines.push(`${outputName}=${value}`);
  }
  return `${lines.join('\n')}\n`;
}

export function recordRunEvidence(options) {
  const arguments_ = [
    artifactWriter,
    'create',
    '--repository-root',
    options.repositoryRoot,
    '--command',
    options.command,
    '--command-version',
    options.commandVersion,
    '--revision',
    options.revision,
    '--environment',
    options.environment,
    '--scope',
    options.scope,
    '--status',
    options.status,
    '--classification',
    'internal',
    '--started-at',
    options.startedAt,
    '--completed-at',
    options.completedAt,
    '--summary-stdin',
  ];
  if (options.dirty === true) {
    arguments_.push('--dirty');
  }
  if (options.retentionClass !== undefined) {
    arguments_.push('--retention-class', options.retentionClass);
  }
  for (const inputHash of options.inputHashes ?? []) {
    arguments_.push('--input-hash', inputHash);
  }
  for (const linkedWork of options.linkedWork ?? []) {
    arguments_.push('--linked-work', linkedWork);
  }
  for (const tool of options.tools ?? []) {
    arguments_.push('--tool-evidence', JSON.stringify(tool));
  }

  const result = spawnSync(process.execPath, arguments_, {
    encoding: 'utf8',
    input: renderSummary(options.summary),
  });
  if (result.status !== 0) {
    throw new Error('Structured run artifact could not be recorded');
  }
  const match = /^created ([a-zA-Z0-9._-]+)\n$/.exec(result.stdout);
  if (!match) {
    throw new Error('Structured run artifact returned an invalid identity');
  }
  return { runId: match[1] };
}
