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

const heifToolIds = new Set([
  'heif-to-jpg',
  'heif-to-pdf',
  'heif-to-png',
  'heif-to-webp',
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
  if (heifToolIds.has(row.toolId)) {
    return Object.freeze({
      groupId: 'wave:heif-browser-libheif',
      reviewCategory: 'existing-browser-code-to-verify',
      testReadiness: 'unresolved',
      decisionCost: 'bounded',
      allowedCandidateIds: new Set(['browser-raster-worker']),
      facts: Object.freeze([
        Object.freeze({
          statement:
            'The browser raster processor already contains a libheif decode path, but the retained HEIF fixture still needs independent identity review.',
          source:
            'apps/tools/lib/convert/workerClient.ts and retained HEIF fixtures',
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
