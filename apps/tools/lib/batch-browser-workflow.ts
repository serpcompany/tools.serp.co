'use client';

import { beginToolRun } from './telemetry.ts';
import { compressPngWithWorker } from './convert/workerClient.ts';
import {
  createBatchToolWorkflow,
  type BatchCompressionPort,
} from './batch-tool-workflow.ts';
import type {
  ToolWorkflow,
  WorkflowDelivery,
  WorkflowMedia,
  WorkflowOutcome,
  WorkflowSnapshot,
} from './tool-workflow/index.ts';

type TelemetryHandle = ReturnType<typeof beginToolRun>;

export type BrowserBatchDeliveries = Readonly<{
  download(delivery: WorkflowDelivery): void;
  release(deliveryId: string): void;
  clear(): void;
}>;

export function createBrowserBatchWorkflow(): Readonly<{
  workflow: ToolWorkflow;
  deliveries: BrowserBatchDeliveries;
}> {
  const mediaById = new Map<string, WorkflowMedia>();
  const objectUrlById = new Map<string, string>();
  const telemetryByRunId = new Map<string, TelemetryHandle>();
  let worker: Worker | undefined;
  let workerCleanupRegistered = false;
  let sequence = 0;

  const compress: BatchCompressionPort = async (request) => {
    if (!worker) {
      worker = new Worker(
        new URL('../workers/compress.worker.js', import.meta.url),
        {
          type: 'module',
        },
      );
    }
    if (!workerCleanupRegistered) {
      workerCleanupRegistered = true;
      await request.registerCleanup(async () => {
        worker?.terminate();
        worker = undefined;
        workerCleanupRegistered = false;
      });
    }
    request.signal.throwIfAborted();
    request.reportProgress(0);
    const output = await compressPngWithWorker({
      worker,
      buf: Uint8Array.from(request.bytes).buffer,
      quality: request.quality,
      signal: request.signal,
    });
    request.reportProgress(1);
    return new Uint8Array(output);
  };

  const release = (deliveryId: string) => {
    const objectUrl = objectUrlById.get(deliveryId);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrlById.delete(deliveryId);
    mediaById.delete(deliveryId);
  };
  const clear = () => {
    for (const deliveryId of [...mediaById.keys()]) release(deliveryId);
  };

  const workflow = createBatchToolWorkflow({
    compress,
    async deliver(media) {
      clear();
      sequence += 1;
      const deliveryId = `batch-delivery-${crypto.randomUUID()}-${sequence}`;
      mediaById.set(deliveryId, media);
      return deliveryId;
    },
    telemetry: {
      async start(runId, request) {
        const media = request.input.kind === 'files' ? request.input.media : [];
        telemetryByRunId.set(
          runId,
          beginToolRun({
            toolId: request.toolId,
            from: 'png',
            to: 'zip',
            inputBytes: media.reduce(
              (total, item) => total + item.bytes.byteLength,
              0,
            ),
            metadata: { fileCount: media.length, partialSuccess: 'fail-fast' },
          }),
        );
      },
      async terminal(runId, status) {
        const telemetry = telemetryByRunId.get(runId);
        telemetryByRunId.delete(runId);
        if (!telemetry) return;
        if (status === 'succeeded') telemetry.finishSuccess({});
        else telemetry.finishFailure({ errorCode: `workflow_${status}` });
      },
    },
    nextId(kind) {
      sequence += 1;
      return `${kind}-${crypto.randomUUID()}-${sequence}`;
    },
  });

  return Object.freeze({
    workflow,
    deliveries: Object.freeze({
      download(delivery: WorkflowDelivery) {
        const media = mediaById.get(delivery.deliveryId);
        if (!media)
          throw new TypeError('Batch delivery is no longer available');
        let objectUrl = objectUrlById.get(delivery.deliveryId);
        if (!objectUrl) {
          objectUrl = URL.createObjectURL(
            new Blob([Uint8Array.from(media.bytes)], { type: media.mimeType }),
          );
          objectUrlById.set(delivery.deliveryId, objectUrl);
        }
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = delivery.name;
        anchor.click();
      },
      release,
      clear,
    }),
  });
}

export type BrowserBatchFile = Readonly<{
  name: string;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export function createBatchRunController(
  workflow: ToolWorkflow,
  options: Readonly<{
    observe?(snapshot: WorkflowSnapshot): void;
    onOutcome?(outcome: WorkflowOutcome): void;
  }> = {},
): Readonly<{
  runFiles(
    files: readonly BrowserBatchFile[],
    compressionLevel: 'low' | 'medium' | 'high' | 'extreme',
  ): Promise<WorkflowOutcome | undefined>;
  cancel(): void;
  dispose(): void;
}> {
  let revision = 0;
  let active: AbortController | undefined;
  const cancel = () => {
    revision += 1;
    active?.abort(new DOMException('Batch cancelled', 'AbortError'));
    active = undefined;
  };
  return Object.freeze({
    async runFiles(files, compressionLevel) {
      cancel();
      const runRevision = revision;
      active = new AbortController();
      const controller = active;
      const media = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          format: 'png',
          mimeType: file.type || 'image/png',
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      );
      if (runRevision !== revision || controller.signal.aborted)
        return undefined;
      const outcome = await workflow.run(
        {
          toolId: 'batch-compress-png',
          input: { kind: 'files', media },
          options: { compressionLevel, partialSuccess: 'fail-fast' },
        },
        {
          signal: controller.signal,
          observe(snapshot) {
            if (runRevision === revision) options.observe?.(snapshot);
          },
        },
      );
      if (runRevision !== revision) return undefined;
      active = undefined;
      options.onOutcome?.(outcome);
      return outcome;
    },
    cancel,
    dispose: cancel,
  });
}
