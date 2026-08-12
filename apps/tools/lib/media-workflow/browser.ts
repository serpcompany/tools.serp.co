import {
  createBrowserWorkflowTelemetry,
  deliverMediaInBrowser,
} from '../browser-workflow-lifecycle.ts';
import type { ToolWorkflow, WorkflowMedia } from '../tool-workflow/index.ts';
import { getMediaWorkflowAdapterRegistration } from './adapter-registration.ts';
import { createMediaWorkflow } from './index.ts';
import { createProductionMediaEndpoint } from './media-endpoint.ts';
import { getExtensionFromName, safeMediaName } from './media-endpoint.ts';
import type { MediaTransferProgress } from './media-endpoint.ts';
import type { TranscriptionPort } from './processors.ts';
import { TRANSCRIPT_OUTPUT } from './verified-formats.ts';
import { classifyMediaRuntimePath } from '../media-runtime-path.ts';

export async function workflowMediaFromFile(
  file: File,
): Promise<WorkflowMedia> {
  const format = getExtensionFromName(file.name);
  if (!format)
    throw new Error('The selected file needs a supported extension.');
  return {
    name: safeMediaName(file.name, 'https://local.invalid/media', format),
    format,
    mimeType: file.type.trim().toLowerCase() || 'application/octet-stream',
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}

export { deliverMediaInBrowser };

export function createBrowserMediaWorkflow(
  options: {
    onDelivered?(media: WorkflowMedia): void;
    onTransfer?(progress: MediaTransferProgress): void;
    releaseDeliveredBytes?: boolean;
    transcription?: TranscriptionPort;
  } = {},
): ToolWorkflow {
  let id = 0;
  return createMediaWorkflow({
    endpoint: createProductionMediaEndpoint(),
    onTransfer: options.onTransfer,
    transcription: options.transcription,
    async deliver(media) {
      deliverMediaInBrowser(media, {
        releaseOwnership: options.releaseDeliveredBytes,
      });
      options.onDelivered?.(media);
      return `browser-delivery-${++id}`;
    },
    telemetry: createBrowserWorkflowTelemetry(
      (request) => {
        const registration = getMediaWorkflowAdapterRegistration(
          request.toolId,
        );
        const from =
          request.input.kind === 'url'
            ? 'url'
            : request.input.kind === 'file'
              ? request.input.media.format
              : request.input.kind;
        const to =
          registration?.family === 'transcription'
            ? TRANSCRIPT_OUTPUT.format
            : request.options &&
                typeof request.options === 'object' &&
                'mode' in request.options &&
                (request.options as { mode?: unknown }).mode === 'audio'
              ? 'audio'
              : 'video';
        return {
          toolId: request.toolId,
          from,
          to,
          inputBytes:
            request.input.kind === 'file'
              ? request.input.media.bytes.byteLength
              : undefined,
          metadata: {
            source: request.input.kind,
            runtimePath: classifyMediaRuntimePath(
              request.toolId,
              request.input,
            ),
          },
        };
      },
      (status) => (status === 'cancelled' ? 'cancelled' : 'workflow_failed'),
    ),
    clock: { now: () => performance.now() },
    nextId(kind) {
      id += 1;
      return `${kind}-${id}`;
    },
  });
}
