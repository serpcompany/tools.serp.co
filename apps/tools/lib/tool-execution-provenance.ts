import type { CatalogTool } from '@serp-tools/app-core/lib/tool-catalog';
import { toolCatalog } from '@serp-tools/app-core/lib/tool-catalog';

import { resolveCompressionDispatch } from './compression-utils.ts';
import { resolveConversionDispatch } from './convert/conversion-dispatch.ts';
import { selectToolRenderer } from './tool-renderer.ts';

export type ExecutionProfile =
  | 'client-only'
  | 'server-assisted'
  | 'server-executed';

export type ProcessingLocation =
  | 'browser'
  | 'browser-with-repository-server-support'
  | 'repository-server';

export type EngineImplementation = Readonly<
  | {
      class: 'library' | 'platform-primitive';
      identity: string;
    }
  | {
      class: 'hybrid' | 'repository-authored';
      identity: string;
      rationale: string;
    }
>;

export type ExecutionEngine = Readonly<{
  id: string;
  capability: string;
  owner: `apps/tools/${string}`;
  processingLocation: ProcessingLocation;
  executionProfile: ExecutionProfile;
  implementation: EngineImplementation;
}>;

export type MappedToolExecutionProvenance = Readonly<{
  kind: 'mapped';
  toolId: string;
  mappingConfidence: 'explicit';
  engineIds: readonly string[];
  executionProfiles: readonly ExecutionProfile[];
}>;

export type UnknownToolExecutionProvenance = Readonly<{
  kind: 'unknown';
  toolId: string;
  mappingConfidence: 'unknown';
  reason: string;
  sourceNeeded: string;
}>;

export type ToolExecutionProvenance =
  | MappedToolExecutionProvenance
  | UnknownToolExecutionProvenance;

type ExecutionEngineDefinition = Omit<ExecutionEngine, 'id'>;

function defineEngines<
  const Definitions extends Record<string, ExecutionEngineDefinition>,
>(definitions: Definitions) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(definitions).map(([id, definition]) => [
        id,
        Object.freeze({
          id,
          ...definition,
          implementation: Object.freeze({ ...definition.implementation }),
        }),
      ]),
    ),
  ) as {
    readonly [Id in keyof Definitions]: Readonly<Definitions[Id] & { id: Id }>;
  };
}

const engineById = defineEngines({
  'adaptive-media-conversion': {
    capability: 'adaptive-media-conversion',
    owner: 'apps/tools/lib/convert/workerClient.ts',
    processingLocation: 'browser-with-repository-server-support',
    executionProfile: 'server-assisted',
    implementation: {
      class: 'hybrid',
      identity: '@ffmpeg/ffmpeg with repository FFmpeg server fallback',
      rationale:
        'Runtime dispatch selects browser or server execution and retains the other available target as a fallback.',
    },
  },
  'browser-raster-worker': {
    capability: 'raster-conversion',
    owner: 'apps/tools/lib/convert/workerClient.ts',
    processingLocation: 'browser',
    executionProfile: 'client-only',
    implementation: {
      class: 'hybrid',
      identity:
        'libheif, WebCodecs ImageDecoder, createImageBitmap, Canvas 2D, and pdf-lib',
      rationale:
        'Repository dispatch uses libheif for HEIC/HEIF inputs, browser image primitives for other raster inputs, Canvas for raster encoding, and pdf-lib for PDF outputs.',
    },
  },
  'browser-tiff-png-worker': {
    capability: 'tiff-to-png-conversion',
    owner: 'apps/tools/lib/convert/tiff.ts',
    processingLocation: 'browser',
    executionProfile: 'client-only',
    implementation: {
      class: 'hybrid',
      identity: 'geotiff 3.0.5 with UPNG.js and browser PNG decoding',
      rationale:
        'A dedicated lazy Worker bounds and decodes one classic TIFF without a nested pool, encodes PNG, and the browser independently decodes and compares delivered RGBA pixels.',
    },
  },
  'browser-ico-png-worker': {
    capability: 'ico-to-png-conversion',
    owner: 'apps/tools/lib/convert/ico.ts',
    processingLocation: 'browser',
    executionProfile: 'client-only',
    implementation: {
      class: 'hybrid',
      identity: 'icojs 1.0.0 with an independent bounded DIB pixel oracle',
      rationale:
        'A dedicated lazy Worker validates every ICO entry, deterministically selects one rendition, decodes it through icojs, and the application independently compares delivered PNG pixels.',
    },
  },
  'browser-pdf-pages': {
    capability: 'pdf-page-rasterization',
    owner: 'apps/tools/lib/convert/pdf.ts',
    processingLocation: 'browser',
    executionProfile: 'client-only',
    implementation: { class: 'library', identity: 'pdfjs-dist' },
  },
  'server-image-convert': {
    capability: 'image-conversion',
    owner: 'apps/tools/app/api/image-convert/route.ts',
    processingLocation: 'repository-server',
    executionProfile: 'server-executed',
    implementation: {
      class: 'hybrid',
      identity: 'ImageMagick, FFmpeg, ExifTool, and @imagemagick/magick-wasm',
      rationale:
        'Repository dispatch selects a trusted decoder and encoder for each declared image format.',
    },
  },
  'browser-raster-with-server-image-decode': {
    capability: 'server-decoded-raster-conversion',
    owner: 'apps/tools/lib/convert/workerClient.ts',
    processingLocation: 'browser-with-repository-server-support',
    executionProfile: 'server-assisted',
    implementation: {
      class: 'hybrid',
      identity:
        'repository server image decoder, WebCodecs ImageDecoder, createImageBitmap, Canvas 2D, and pdf-lib',
      rationale:
        'The repository server emits PNG; browser image and Canvas primitives produce raster outputs, while pdf-lib packages PDF outputs.',
    },
  },
  'browser-ffmpeg-wasm': {
    capability: 'media-conversion',
    owner: 'apps/tools/lib/convert/video.ts',
    processingLocation: 'browser',
    executionProfile: 'client-only',
    implementation: {
      class: 'library',
      identity: '@ffmpeg/ffmpeg and @ffmpeg/core',
    },
  },
  'server-video-convert': {
    capability: 'media-conversion',
    owner: 'apps/tools/app/api/video-convert/route.ts',
    processingLocation: 'repository-server',
    executionProfile: 'server-executed',
    implementation: { class: 'library', identity: 'FFmpeg executable' },
  },
  'browser-image-compression-worker': {
    capability: 'image-compression',
    owner: 'apps/tools/lib/convert/workerClient.ts',
    processingLocation: 'browser',
    executionProfile: 'client-only',
    implementation: {
      class: 'hybrid',
      identity:
        '@jsquash image codecs with UPNG.js and browser Canvas fallbacks',
      rationale:
        'The compression worker uses JSquash; repository fallbacks use UPNG.js for PNG and platform image/Canvas primitives for other browser images.',
    },
  },
  'browser-svg-optimization-worker': {
    capability: 'svg-compression',
    owner: 'apps/tools/lib/svg-compression.ts',
    processingLocation: 'browser',
    executionProfile: 'client-only',
    implementation: {
      class: 'hybrid',
      identity: 'SVGO 4.0.2 with bounded inert-SVG policy',
      rationale:
        'SVGO performs one optimization pass in a dedicated Worker after repository policy rejects active, external, malformed, and over-budget SVG input.',
    },
  },
  'browser-ffmpeg-compression': {
    capability: 'media-compression',
    owner: 'apps/tools/lib/convert/video.ts',
    processingLocation: 'browser',
    executionProfile: 'client-only',
    implementation: {
      class: 'library',
      identity: '@ffmpeg/ffmpeg and @ffmpeg/core',
    },
  },
  'server-image-compression': {
    capability: 'image-compression',
    owner: 'apps/tools/app/api/image-compress/route.ts',
    processingLocation: 'repository-server',
    executionProfile: 'server-executed',
    implementation: {
      class: 'hybrid',
      identity: 'sharp, imagemin-gifsicle, and svgo',
      rationale:
        'Repository dispatch selects a maintained compressor for each declared image format.',
    },
  },
  'server-pdf-compression': {
    capability: 'pdf-compression',
    owner: 'apps/tools/app/api/pdf-compress/route.ts',
    processingLocation: 'repository-server',
    executionProfile: 'server-executed',
    implementation: { class: 'library', identity: 'ghostscript-node' },
  },
  'server-media-fetch': {
    capability: 'public-media-download',
    owner: 'apps/tools/app/api/media-fetch/route.ts',
    processingLocation: 'repository-server',
    executionProfile: 'server-executed',
    implementation: {
      class: 'hybrid',
      identity:
        'youtube-dl-exec, repository extractors, Fetch API, and ReadableStream',
      rationale:
        'Repository dispatch validates public sources, selects extraction or direct streaming, and preserves backpressure through platform streams.',
    },
  },
  'browser-transformers-transcription': {
    capability: 'media-transcription',
    owner: 'apps/tools/lib/media-workflow/transcription-browser.ts',
    processingLocation: 'browser',
    executionProfile: 'client-only',
    implementation: {
      class: 'library',
      identity: '@xenova/transformers',
    },
  },
  'server-media-fetch-for-browser-transcription': {
    capability: 'remote-media-retrieval-for-browser-transcription',
    owner: 'apps/tools/app/api/media-fetch/route.ts',
    processingLocation: 'browser-with-repository-server-support',
    executionProfile: 'server-assisted',
    implementation: {
      class: 'hybrid',
      identity:
        'youtube-dl-exec, repository extractors, Fetch API, and ReadableStream',
      rationale:
        'Repository dispatch validates public sources and streams supported media to the browser-owned transcription engine.',
    },
  },
  'browser-table-converter': {
    capability: 'structured-data-conversion',
    owner: 'apps/tools/lib/table-tool-processors.ts',
    processingLocation: 'browser',
    executionProfile: 'client-only',
    implementation: {
      class: 'hybrid',
      identity:
        'Papa Parse, read-excel-file, write-excel-file, parse5, fast-xml-parser, yaml, markdown-table, pdf-lib, pdfjs-dist, and bounded repository codecs',
      rationale:
        'Maintained parsers and serializers own standard formats; pdfjs-dist independently extracts PDF text and actual page geometry for comparison with the source table; bounded repository codecs cover narrow SQL, LaTeX, Markdown-input, and MediaWiki contracts with semantic round-trip fixtures.',
    },
  },
  'browser-html-to-markdown': {
    capability: 'html-to-markdown-conversion',
    owner: 'apps/tools/lib/specialized-tool-workflow.ts',
    processingLocation: 'browser',
    executionProfile: 'client-only',
    implementation: {
      class: 'library',
      identity: '@kreuzberg/html-to-markdown-wasm',
    },
  },
  'browser-json-to-csv': {
    capability: 'json-to-csv-conversion',
    owner: 'apps/tools/lib/specialized-tool-workflow.ts',
    processingLocation: 'browser',
    executionProfile: 'client-only',
    implementation: {
      class: 'library',
      identity: 'Papa Parse 5',
    },
  },
  'browser-csv-combiner': {
    capability: 'csv-combination',
    owner: 'apps/tools/lib/specialized-tool-workflow.ts',
    processingLocation: 'browser',
    executionProfile: 'client-only',
    implementation: {
      class: 'hybrid',
      identity: 'Papa Parse 5 with bounded schema-union policy',
      rationale:
        'Papa Parse owns CSV grammar including multiline cells; bounded repository policy unions headers and aligns rows.',
    },
  },
  'browser-character-counter': {
    capability: 'text-statistics',
    owner: 'apps/tools/lib/specialized-tool-workflow.ts',
    processingLocation: 'browser',
    executionProfile: 'client-only',
    implementation: {
      class: 'repository-authored',
      identity: 'bounded character-statistics policy',
      rationale:
        'The operation computes transparent text statistics without a codec or external protocol.',
    },
  },
  'browser-pdf-viewer': {
    capability: 'pdf-viewing-and-annotation',
    owner: 'apps/tools/lib/specialized-tool-workflow.ts',
    processingLocation: 'browser',
    executionProfile: 'client-only',
    implementation: {
      class: 'hybrid',
      identity: 'pdfjs-dist parser plus vendored PDF.js annotation viewer',
      rationale:
        'The processor requires PDF.js to parse the document before delivery; the vendored viewer owns rendering, annotations, and export.',
    },
  },
  'browser-batch-png-compression': {
    capability: 'batch-png-compression',
    owner: 'apps/tools/lib/batch-tool-workflow.ts',
    processingLocation: 'browser',
    executionProfile: 'client-only',
    implementation: {
      class: 'library',
      identity: '@jsquash/oxipng and @zip.js/zip.js',
    },
  },
} satisfies Record<string, ExecutionEngineDefinition>);

type EngineId = keyof typeof engineById;

const transcriptionEngineIds = Object.freeze([
  'browser-transformers-transcription',
  'server-media-fetch-for-browser-transcription',
] satisfies readonly EngineId[]);

const specializedEngineIdsByToolId = Object.freeze({
  'audio-to-text': transcriptionEngineIds,
  'audio-to-transcript': transcriptionEngineIds,
  'batch-compress-png': ['browser-batch-png-compression'],
  'character-counter': ['browser-character-counter'],
  'csv-combiner': ['browser-csv-combiner'],
  'html-to-markdown': ['browser-html-to-markdown'],
  'json-to-csv': ['browser-json-to-csv'],
  'mp3-to-transcript': transcriptionEngineIds,
  'mp4-to-transcript': transcriptionEngineIds,
  'tiktok-to-transcript': transcriptionEngineIds,
  'video-to-transcript': transcriptionEngineIds,
  'youtube-to-transcript': transcriptionEngineIds,
  'youtube-to-transcript-generator': transcriptionEngineIds,
} satisfies Record<string, readonly EngineId[]>);

const executionProfileOrder: readonly ExecutionProfile[] = [
  'client-only',
  'server-assisted',
  'server-executed',
];

function conversionEngineIds(tool: CatalogTool): readonly EngineId[] | null {
  if (!tool.from || !tool.to) return null;
  return knownEngineIds(
    resolveConversionDispatch(tool.from, tool.to).engineIds,
  );
}

function compressionEngineIds(tool: CatalogTool): readonly EngineId[] | null {
  if (!tool.from) return null;
  const engineIds = knownEngineIds(
    resolveCompressionDispatch(tool.from).engineIds,
  );
  return engineIds.length ? engineIds : null;
}

function knownEngineIds(engineIds: readonly string[]): readonly EngineId[] {
  for (const engineId of engineIds) {
    if (!isEngineId(engineId)) {
      throw new TypeError(`Unknown execution engine id: ${engineId}`);
    }
  }
  return engineIds as readonly EngineId[];
}

function isEngineId(engineId: string): engineId is EngineId {
  return Object.hasOwn(engineById, engineId);
}

function engineIdsForTool(tool: CatalogTool): readonly EngineId[] | null {
  const specialized =
    specializedEngineIdsByToolId[
      tool.id as keyof typeof specializedEngineIdsByToolId
    ];
  if (specialized) return specialized;

  const renderer = selectToolRenderer(tool);
  if (renderer === 'table') return ['browser-table-converter'];
  if (renderer === 'downloader') return ['server-media-fetch'];
  if (renderer === 'pdf') return ['browser-pdf-viewer'];
  if (tool.operation === 'compress') return compressionEngineIds(tool);
  if (renderer === 'generic') return conversionEngineIds(tool);
  return null;
}

function mappedProvenance(
  toolId: string,
  engineIds: readonly EngineId[],
): MappedToolExecutionProvenance {
  const frozenEngineIds = Object.freeze([...engineIds]);
  const profiles = Object.freeze(
    executionProfileOrder.filter((profile) =>
      frozenEngineIds.some(
        (engineId) => engineById[engineId].executionProfile === profile,
      ),
    ),
  );
  return Object.freeze({
    kind: 'mapped',
    toolId,
    mappingConfidence: 'explicit',
    engineIds: frozenEngineIds,
    executionProfiles: profiles,
  });
}

function unknownProvenance(
  toolId: string,
  reason: string,
  sourceNeeded: string,
): UnknownToolExecutionProvenance {
  return Object.freeze({
    kind: 'unknown',
    toolId,
    mappingConfidence: 'unknown',
    reason,
    sourceNeeded,
  });
}

const provenanceByToolId = new Map<string, ToolExecutionProvenance>(
  toolCatalog.tools.map((tool) => {
    const engineIds = engineIdsForTool(tool);
    return [
      tool.id,
      engineIds
        ? mappedProvenance(tool.id, engineIds)
        : unknownProvenance(
            tool.id,
            'No maintained execution mapping exists for this Tool renderer.',
            'Trace the active renderer to the function that performs its core operation.',
          ),
    ];
  }),
);

export function getToolExecutionProvenance(
  toolId: string,
): ToolExecutionProvenance {
  return (
    provenanceByToolId.get(toolId) ??
    unknownProvenance(
      toolId,
      'The Tool id is not present in the Tool Catalog.',
      'Add or correct the canonical Tool id before mapping execution ownership.',
    )
  );
}

export const executionProvenance = Object.freeze({
  engines: Object.freeze(Object.values(engineById)),
  getEngine(engineId: string): ExecutionEngine | undefined {
    return isEngineId(engineId) ? engineById[engineId] : undefined;
  },
  getByToolId: getToolExecutionProvenance,
});
