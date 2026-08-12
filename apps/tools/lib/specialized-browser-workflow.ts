'use client';

import {
  createBrowserDeliveryStore,
  createBrowserWorkflowTelemetry,
} from './browser-workflow-lifecycle.ts';
import {
  createSpecializedToolWorkflow,
  type SpecializedWorkflowDeliveryPort,
} from './specialized-tool-workflow.ts';
import type {
  ToolWorkflow,
  WorkflowDelivery,
  WorkflowMedia,
  WorkflowOutcome,
  WorkflowSnapshot,
} from './tool-workflow/index.ts';

export type BrowserSpecializedDeliveries = Readonly<{
  get(deliveryId: string): WorkflowMedia | undefined;
  text(deliveryId: string): string | undefined;
  objectUrl(deliveryId: string): string | undefined;
  download(delivery: WorkflowDelivery): void;
  release(deliveryId: string): void;
  clear(): void;
}>;

export function createBrowserSpecializedWorkflow(): Readonly<{
  workflow: ToolWorkflow;
  deliveries: BrowserSpecializedDeliveries;
}> {
  const deliveries = createBrowserDeliveryStore({
    idPrefix: 'specialized-delivery',
  });
  let sequence = 0;
  const deliver: SpecializedWorkflowDeliveryPort = deliveries.deliver;

  const workflow = createSpecializedToolWorkflow({
    deliver,
    nextId(kind) {
      sequence += 1;
      return `${kind}-${crypto.randomUUID()}-${sequence}`;
    },
    telemetry: createBrowserWorkflowTelemetry((request) => {
      const inputBytes =
        request.input.kind === 'file'
          ? request.input.media.bytes.byteLength
          : request.input.kind === 'files'
            ? request.input.media.reduce(
                (total, media) => total + media.bytes.byteLength,
                0,
              )
            : request.input.kind === 'interaction'
              ? request.input.interaction.bytes
              : undefined;
      return {
        toolId: request.toolId,
        inputBytes,
        metadata:
          request.input.kind === 'files'
            ? { fileCount: request.input.media.length }
            : undefined,
      };
    }),
  });

  return Object.freeze({
    workflow,
    deliveries,
  });
}

export type BrowserFile = Readonly<{
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export type SpecializedInteractionRequest = Readonly<{
  toolId: string;
  format: string;
  mimeType: string;
  value: string;
}>;

function mediaFormat(file: BrowserFile): string {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension) return extension === 'md' ? 'markdown' : extension;
  if (file.type === 'application/pdf') return 'pdf';
  if (file.type === 'text/csv') return 'csv';
  return 'unknown';
}

function mediaMimeType(file: BrowserFile, format: string): string {
  if (file.type) return file.type;
  if (format === 'csv') return 'text/csv';
  if (format === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
}

export function createSpecializedRunController(
  workflow: ToolWorkflow,
  options: Readonly<{
    observe?(snapshot: WorkflowSnapshot): void;
    onOutcome?(outcome: WorkflowOutcome): void;
  }> = {},
): Readonly<{
  runInteraction(
    request: SpecializedInteractionRequest,
  ): Promise<WorkflowOutcome | undefined>;
  runFile(
    toolId: string,
    file: BrowserFile,
  ): Promise<WorkflowOutcome | undefined>;
  runFiles(
    toolId: string,
    files: readonly BrowserFile[],
  ): Promise<WorkflowOutcome | undefined>;
  scheduleInteraction(
    request: SpecializedInteractionRequest,
    delay?: number,
  ): void;
  clear(): void;
  dispose(): void;
}> {
  let revision = 0;
  let active: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const begin = () => {
    revision += 1;
    active?.abort();
    active = new AbortController();
    return { revision, controller: active };
  };
  const current = (runRevision: number) => runRevision === revision;
  const workflowOptions = (run: ReturnType<typeof begin>) => ({
    signal: run.controller.signal,
    observe(snapshot: WorkflowSnapshot) {
      if (current(run.revision)) options.observe?.(snapshot);
    },
  });
  const invalidateActive = () => {
    revision += 1;
    active?.abort();
    active = undefined;
  };
  const clear = () => {
    invalidateActive();
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  return Object.freeze({
    async runInteraction(request) {
      if (timer) clearTimeout(timer);
      timer = undefined;
      const run = begin();
      const outcome = await workflow.run(
        {
          toolId: request.toolId,
          input: {
            kind: 'interaction',
            interaction: {
              format: request.format,
              mimeType: request.mimeType,
              value: request.value,
              bytes: new TextEncoder().encode(request.value).byteLength,
            },
          },
        },
        workflowOptions(run),
      );
      if (!current(run.revision)) return undefined;
      options.onOutcome?.(outcome);
      return outcome;
    },
    async runFile(toolId, file) {
      const run = begin();
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!current(run.revision)) return undefined;
      const format = mediaFormat(file);
      const outcome = await workflow.run(
        {
          toolId,
          input: {
            kind: 'file',
            media: {
              name: file.name,
              format,
              mimeType: mediaMimeType(file, format),
              bytes,
            },
          },
        },
        workflowOptions(run),
      );
      if (!current(run.revision)) return undefined;
      options.onOutcome?.(outcome);
      return outcome;
    },
    async runFiles(toolId, files) {
      const run = begin();
      const bytes = await Promise.all(files.map((file) => file.arrayBuffer()));
      if (!current(run.revision)) return undefined;
      const outcome = await workflow.run(
        {
          toolId,
          input: {
            kind: 'files',
            media: files.map((file, index) => {
              const format = mediaFormat(file);
              return {
                name: file.name,
                format,
                mimeType: mediaMimeType(file, format),
                bytes: new Uint8Array(bytes[index]!),
              };
            }),
          },
        },
        workflowOptions(run),
      );
      if (!current(run.revision)) return undefined;
      options.onOutcome?.(outcome);
      return outcome;
    },
    scheduleInteraction(request, delay = 800) {
      invalidateActive();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void this.runInteraction(request);
      }, delay);
    },
    clear,
    dispose: clear,
  });
}
