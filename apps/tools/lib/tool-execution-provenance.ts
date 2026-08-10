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

export type ExecutionEngine = Readonly<{
  id: string;
  capability: string;
  owner: `apps/tools/${string}`;
  processingLocation: ProcessingLocation;
  executionProfile: ExecutionProfile;
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
        Object.freeze({ id, ...definition }),
      ]),
    ),
  ) as {
    readonly [Id in keyof Definitions]: Readonly<
      Definitions[Id] & { id: Id }
    >;
  };
}

const engineById = defineEngines({
  'browser-raster-worker': {
    capability: 'raster-conversion',
    owner: 'apps/tools/lib/convert/workerClient.ts',
    processingLocation: 'browser',
    executionProfile: 'client-only',
  },
  'browser-pdf-pages': {
    capability: 'pdf-page-rasterization',
    owner: 'apps/tools/lib/convert/pdf.ts',
    processingLocation: 'browser',
    executionProfile: 'client-only',
  },
  'server-image-convert': {
    capability: 'image-conversion',
    owner: 'apps/tools/app/api/image-convert/route.ts',
    processingLocation: 'repository-server',
    executionProfile: 'server-executed',
  },
  'browser-raster-with-server-image-decode': {
    capability: 'server-decoded-raster-conversion',
    owner: 'apps/tools/lib/convert/workerClient.ts',
    processingLocation: 'browser-with-repository-server-support',
    executionProfile: 'server-assisted',
  },
  'browser-ffmpeg-wasm': {
    capability: 'media-conversion',
    owner: 'apps/tools/lib/convert/video.ts',
    processingLocation: 'browser',
    executionProfile: 'client-only',
  },
  'server-video-convert': {
    capability: 'media-conversion',
    owner: 'apps/tools/app/api/video-convert/route.ts',
    processingLocation: 'repository-server',
    executionProfile: 'server-executed',
  },
  'browser-image-compression-worker': {
    capability: 'image-compression',
    owner: 'apps/tools/lib/convert/workerClient.ts',
    processingLocation: 'browser',
    executionProfile: 'client-only',
  },
  'browser-ffmpeg-compression': {
    capability: 'media-compression',
    owner: 'apps/tools/lib/convert/video.ts',
    processingLocation: 'browser',
    executionProfile: 'client-only',
  },
  'server-image-compression': {
    capability: 'image-compression',
    owner: 'apps/tools/app/api/image-compress/route.ts',
    processingLocation: 'repository-server',
    executionProfile: 'server-executed',
  },
  'server-pdf-compression': {
    capability: 'pdf-compression',
    owner: 'apps/tools/app/api/pdf-compress/route.ts',
    processingLocation: 'repository-server',
    executionProfile: 'server-executed',
  },
  'server-media-fetch': {
    capability: 'public-media-download',
    owner: 'apps/tools/app/api/media-fetch/route.ts',
    processingLocation: 'repository-server',
    executionProfile: 'server-executed',
  },
  'browser-transformers-transcription': {
    capability: 'media-transcription',
    owner: 'apps/tools/components/TranscribeTool.tsx',
    processingLocation: 'browser',
    executionProfile: 'client-only',
  },
  'server-media-fetch-for-browser-transcription': {
    capability: 'remote-media-retrieval-for-browser-transcription',
    owner: 'apps/tools/app/api/media-fetch/route.ts',
    processingLocation: 'browser-with-repository-server-support',
    executionProfile: 'server-assisted',
  },
  'browser-table-converter': {
    capability: 'structured-data-conversion',
    owner: 'apps/tools/components/table-convert/convert.ts',
    processingLocation: 'browser',
    executionProfile: 'client-only',
  },
  'browser-html-to-markdown': {
    capability: 'html-to-markdown-conversion',
    owner: 'apps/tools/components/HtmlToMarkdownConverter.tsx',
    processingLocation: 'browser',
    executionProfile: 'client-only',
  },
  'browser-json-to-csv': {
    capability: 'json-to-csv-conversion',
    owner: 'apps/tools/components/JsonToCsv.tsx',
    processingLocation: 'browser',
    executionProfile: 'client-only',
  },
  'browser-csv-combiner': {
    capability: 'csv-combination',
    owner: 'apps/tools/components/CsvCombiner.tsx',
    processingLocation: 'browser',
    executionProfile: 'client-only',
  },
  'browser-character-counter': {
    capability: 'text-statistics',
    owner: 'apps/tools/components/CharacterCounter.tsx',
    processingLocation: 'browser',
    executionProfile: 'client-only',
  },
  'browser-pdf-viewer': {
    capability: 'pdf-viewing-and-annotation',
    owner: 'apps/tools/components/PdfTool.tsx',
    processingLocation: 'browser',
    executionProfile: 'client-only',
  },
  'browser-batch-png-compression': {
    capability: 'batch-png-compression',
    owner: 'apps/tools/components/BatchHeroConverter.tsx',
    processingLocation: 'browser',
    executionProfile: 'client-only',
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
