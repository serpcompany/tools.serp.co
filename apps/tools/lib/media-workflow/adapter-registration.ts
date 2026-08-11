import { toolCatalog } from '@serp-tools/app-core/lib/tool-catalog';

import { selectToolRenderer } from '../tool-renderer.ts';
import { TRANSCRIPTION_TOOL_IDS } from './tool-family.ts';

export { TRANSCRIPTION_TOOL_IDS } from './tool-family.ts';

export const STREAMED_MEDIA_WORKFLOW_ADAPTER_ID = 'streamed-media-workflow';

export type MediaWorkflowFamily = 'downloader' | 'transcription';

export type MediaWorkflowAdapterRegistration = Readonly<{
  toolId: string;
  family: MediaWorkflowFamily;
  adapterId: typeof STREAMED_MEDIA_WORKFLOW_ADAPTER_ID;
}>;

/**
 * Application-owned executable wiring projection for issue #82. Every active
 * Tool owned by the shared downloader renderer is one implementation family;
 * transcription remains an explicit Tool-id family. Neither family is
 * inferred from implementation provenance.
 */
export const mediaWorkflowAdapterRegistrations = Object.freeze([
  ...toolCatalog.activeTools
    .filter((tool) => selectToolRenderer(tool) === 'downloader')
    .map((tool) =>
      Object.freeze({
        toolId: tool.id,
        family: 'downloader' as const,
        adapterId: STREAMED_MEDIA_WORKFLOW_ADAPTER_ID,
      }),
    ),
  ...TRANSCRIPTION_TOOL_IDS.map((toolId) =>
    Object.freeze({
      toolId,
      family: 'transcription' as const,
      adapterId: STREAMED_MEDIA_WORKFLOW_ADAPTER_ID,
    }),
  ),
]);

const registrationByToolId = new Map(
  mediaWorkflowAdapterRegistrations.map((registration) => [
    registration.toolId,
    registration,
  ]),
);

export function getMediaWorkflowAdapterRegistration(
  toolId: string,
): MediaWorkflowAdapterRegistration | undefined {
  return registrationByToolId.get(toolId);
}
