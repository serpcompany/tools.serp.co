import crypto from 'node:crypto';

const invariantByToolId = Object.freeze({
  'png-to-webp': 'generic-file-exact-output',
  'video-downloader': 'url-stream-exact-output',
  'batch-compress-png': 'batch-archive-semantics',
  'csv-to-json': 'table-row-header-value-semantics',
  'json-to-csv': 'specialized-output-semantics',
  'html-to-markdown': 'specialized-output-semantics',
  'character-counter': 'specialized-output-semantics',
  'csv-combiner': 'specialized-output-semantics',
  'pdf-reader': 'specialized-output-semantics',
  'audio-to-text': 'transcription-terminal',
});

export function buildBrowserScope({ mode, environment, toolIds, filtered }) {
  const selection = filtered ? 'subset' : 'all';
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify(toolIds))
    .digest('hex');
  return {
    label: `browser-${mode}-${environment}-${selection}`,
    inputHashes: [`sha256:${digest}`],
    toolIds: Object.freeze([...toolIds]),
    invariants: Object.freeze(
      [
        ...new Set(
          toolIds.map((toolId) => invariantByToolId[toolId]).filter(Boolean),
        ),
      ].sort(),
    ),
  };
}

export function summarizeNavigationTimings(values) {
  const timings = values
    .filter((value) => Number.isSafeInteger(value) && value >= 0)
    .sort((left, right) => left - right);
  if (timings.length === 0) {
    return {};
  }
  const percentile = (fraction) =>
    timings[Math.max(0, Math.ceil(timings.length * fraction) - 1)];
  return {
    samples: timings.length,
    minMs: timings[0],
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: timings.at(-1),
  };
}
