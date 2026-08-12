import type { ToolFactoryRow } from './tool-factory-read-model.ts';

export type ClientFirstReviewCategory =
  | 'existing-browser-code-to-verify'
  | 'browser-library-research'
  | 'server-alternative-research'
  | 'catalog-review'
  | 'unresolved';

export type ClientFirstDecision = Readonly<{
  groupId: string;
  reviewCategory: ClientFirstReviewCategory;
  testReadiness: 'fixture-and-verifiers' | 'unresolved';
  decisionCost: 'bounded' | 'multiple-open-decisions';
  allowedCandidateIds?: ReadonlySet<string>;
  facts: readonly Readonly<{ statement: string; source: string }>[];
}>;

const webmToolIds = new Set([
  'compress-webm',
  'webm-to-m4a',
  'webm-to-mp3',
  'webm-to-mp4',
]);

export function getClientFirstDecision(
  row: ToolFactoryRow,
): ClientFirstDecision {
  if (row.support.disposition !== 'unsupported') {
    return Object.freeze({
      groupId: row.family,
      reviewCategory: 'unresolved',
      testReadiness: 'unresolved',
      decisionCost: 'multiple-open-decisions',
      facts: Object.freeze([]),
    });
  }
  if (webmToolIds.has(row.toolId)) {
    return Object.freeze({
      groupId: 'wave:webm-browser-ffmpeg',
      reviewCategory: 'existing-browser-code-to-verify',
      testReadiness: 'fixture-and-verifiers',
      decisionCost: 'bounded',
      allowedCandidateIds: new Set([
        'browser-ffmpeg-compression',
        'browser-ffmpeg-wasm',
      ]),
      facts: Object.freeze([
        Object.freeze({
          statement:
            'A distinct WebM fixture and semantic parsers for the exact input/output formats are maintained in the repository.',
          source:
            'apps/tools/benchmarks/fixtures/sample.webm and workflow semantic validators',
        }),
      ]),
    });
  }
  if (
    row.catalogIntent.inputFormat &&
    row.catalogIntent.inputFormat === row.catalogIntent.outputFormat
  ) {
    return Object.freeze({
      groupId: 'review:same-format-catalog-intent',
      reviewCategory: 'catalog-review',
      testReadiness: 'unresolved',
      decisionCost: 'bounded',
      facts: Object.freeze([
        Object.freeze({
          statement: 'Catalog input and output formats are identical.',
          source: 'Tool Catalog intent',
        }),
      ]),
    });
  }
  if (row.family === 'generic-convert:browser-raster') {
    return Object.freeze({
      groupId: row.family,
      reviewCategory: 'browser-library-research',
      testReadiness: 'unresolved',
      decisionCost: 'multiple-open-decisions',
      facts: Object.freeze([
        Object.freeze({
          statement:
            'Maintained provenance maps a browser raster candidate; exact format support is unverified.',
          source: 'Maintained execution provenance',
        }),
      ]),
    });
  }
  if (
    row.family === 'generic-convert:server-assisted-image' ||
    row.family === 'generic-convert:server-image' ||
    row.family === 'generic-compress:image-server' ||
    row.family === 'generic-compress:pdf'
  ) {
    return Object.freeze({
      groupId: row.family,
      reviewCategory: 'server-alternative-research',
      testReadiness: 'unresolved',
      decisionCost: 'multiple-open-decisions',
      facts: Object.freeze([
        Object.freeze({
          statement:
            'Today’s mapped candidate uses server participation; a browser replacement has not been ruled out.',
          source: 'Maintained execution provenance',
        }),
      ]),
    });
  }
  return Object.freeze({
    groupId: row.family,
    reviewCategory: 'unresolved',
    testReadiness: 'unresolved',
    decisionCost: 'multiple-open-decisions',
    facts: Object.freeze([]),
  });
}
