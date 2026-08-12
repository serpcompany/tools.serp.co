'use client';

import {
  createBrowserDeliveryStore,
  createBrowserWorkflowTelemetry,
  createLatestAsyncReader,
} from './browser-workflow-lifecycle.ts';
import { createTableToolWorkflow } from './table-tool-processors.ts';
import type { WorkflowDelivery, WorkflowMedia } from './tool-workflow/index.ts';

export const createLatestFileReader = () =>
  createLatestAsyncReader(
    async (file: Pick<File, 'arrayBuffer'>) =>
      new Uint8Array(await file.arrayBuffer()),
  );

export type BrowserTableDeliveries = Readonly<{
  get(deliveryId: string): WorkflowMedia | undefined;
  text(deliveryId: string): string | undefined;
  download(delivery: WorkflowDelivery): void;
  release(deliveryId: string): void;
  clear(): void;
}>;

export function createBrowserTableWorkflow(): Readonly<{
  workflow: ReturnType<typeof createTableToolWorkflow>;
  deliveries: BrowserTableDeliveries;
}> {
  const deliveries = createBrowserDeliveryStore({
    idPrefix: 'table-delivery',
    isText(media) {
      return (
        media.mimeType.startsWith('text/') ||
        [
          'application/json',
          'application/sql',
          'application/x-ndjson',
          'application/xml',
          'application/yaml',
        ].includes(media.mimeType)
      );
    },
  });

  let sequence = 0;
  const workflow = createTableToolWorkflow({
    nextId(kind) {
      sequence += 1;
      return `${kind}-${crypto.randomUUID()}-${sequence}`;
    },
    deliver: deliveries.deliver,
    telemetry: createBrowserWorkflowTelemetry((request) => {
      const media =
        request.input.kind === 'file' ? request.input.media : undefined;
      return {
        toolId: request.toolId,
        from: media?.format,
        inputBytes: media?.bytes.byteLength,
      };
    }),
  });

  return Object.freeze({
    workflow,
    deliveries,
  });
}
