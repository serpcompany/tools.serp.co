import { toolCatalog } from '@serp-tools/app-core/lib/tool-catalog';

import { getToolExecutionProvenance } from './tool-execution-provenance.ts';

export type WiredToolProcessorAvailability = Readonly<{
  kind: 'wired';
  toolId: string;
  adapterId: string;
}>;

export type UnwiredToolProcessorAvailability = Readonly<{
  kind: 'unwired';
  toolId: string;
  reason: string;
  sourceNeeded: string;
}>;

export type UnknownToolProcessorAvailability = Readonly<{
  kind: 'unknown';
  toolId: string;
  reason: string;
  sourceNeeded: string;
}>;

export type ToolProcessorAvailability =
  | WiredToolProcessorAvailability
  | UnwiredToolProcessorAvailability
  | UnknownToolProcessorAvailability;

const registeredAdapterIdByToolId: Readonly<Record<string, string>> =
  Object.freeze({
    'audio-to-text': 'streamed-media-workflow',
    'audio-to-transcript': 'streamed-media-workflow',
    'download-loom-videos': 'streamed-media-workflow',
    'mp3-to-transcript': 'streamed-media-workflow',
    'mp4-to-transcript': 'streamed-media-workflow',
    'tiktok-to-transcript': 'streamed-media-workflow',
    'video-downloader': 'streamed-media-workflow',
    'video-to-transcript': 'streamed-media-workflow',
    'youtube-to-transcript': 'streamed-media-workflow',
    'youtube-to-transcript-generator': 'streamed-media-workflow',
  });

function availabilityForToolId(toolId: string): ToolProcessorAvailability {
  const adapterId = registeredAdapterIdByToolId[toolId];
  if (adapterId) {
    return Object.freeze({ kind: 'wired', toolId, adapterId });
  }

  const provenance = getToolExecutionProvenance(toolId);
  if (provenance.kind === 'unknown') {
    return Object.freeze({
      kind: 'unknown',
      toolId,
      reason: provenance.reason,
      sourceNeeded: provenance.sourceNeeded,
    });
  }

  return Object.freeze({
    kind: 'unwired',
    toolId,
    reason:
      'Execution provenance is known, but no processor adapter is registered for the shared workflow.',
    sourceNeeded:
      'Register a processor adapter only when this Tool family migrates to the shared workflow.',
  });
}

const availabilityByToolId = new Map<string, ToolProcessorAvailability>(
  toolCatalog.tools.map((tool) => [tool.id, availabilityForToolId(tool.id)]),
);

export function getToolProcessorAvailability(
  toolId: string,
): ToolProcessorAvailability {
  return (
    availabilityByToolId.get(toolId) ??
    Object.freeze({
      kind: 'unknown',
      toolId,
      reason: 'The Tool id is not present in the Tool Catalog.',
      sourceNeeded:
        'Add or correct the canonical Tool id before registering a processor adapter.',
    })
  );
}

export const toolProcessorRegistry = Object.freeze({
  getByToolId: getToolProcessorAvailability,
});
