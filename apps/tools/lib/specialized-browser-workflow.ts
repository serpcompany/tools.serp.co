"use client";

import { beginToolRun } from "./telemetry.ts";
import {
  createSpecializedToolWorkflow,
  type SpecializedWorkflowDeliveryPort,
} from "./specialized-tool-workflow.ts";
import type {
  ToolWorkflow,
  WorkflowDelivery,
  WorkflowMedia,
  WorkflowOutcome,
} from "./tool-workflow/index.ts";

type TelemetryHandle = ReturnType<typeof beginToolRun>;

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
  const mediaById = new Map<string, WorkflowMedia>();
  const objectUrlById = new Map<string, string>();
  const telemetryByRunId = new Map<string, TelemetryHandle>();

  const release = (deliveryId: string) => {
    const objectUrl = objectUrlById.get(deliveryId);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrlById.delete(deliveryId);
    mediaById.delete(deliveryId);
  };
  const clear = () => {
    for (const deliveryId of [...mediaById.keys()]) release(deliveryId);
  };
  let sequence = 0;
  const deliver: SpecializedWorkflowDeliveryPort = async (media) => {
    clear();
    sequence += 1;
    const deliveryId = `specialized-delivery-${crypto.randomUUID()}-${sequence}`;
    mediaById.set(deliveryId, media);
    return deliveryId;
  };

  const workflow = createSpecializedToolWorkflow({
    deliver,
    nextId(kind) {
      sequence += 1;
      return `${kind}-${crypto.randomUUID()}-${sequence}`;
    },
    telemetry: {
      async start(runId, request) {
        const inputBytes = request.input.kind === "file"
          ? request.input.media.bytes.byteLength
          : request.input.kind === "files"
            ? request.input.media.reduce((total, media) => total + media.bytes.byteLength, 0)
            : request.input.kind === "interaction"
              ? request.input.interaction.bytes
              : undefined;
        telemetryByRunId.set(runId, beginToolRun({
          toolId: request.toolId,
          inputBytes,
          metadata: request.input.kind === "files"
            ? { fileCount: request.input.media.length }
            : undefined,
        }));
      },
      async terminal(runId, status) {
        const telemetry = telemetryByRunId.get(runId);
        telemetryByRunId.delete(runId);
        if (!telemetry) return;
        if (status === "succeeded") telemetry.finishSuccess({});
        else telemetry.finishFailure({ errorCode: `workflow_${status}` });
      },
    },
  });

  return Object.freeze({
    workflow,
    deliveries: Object.freeze({
      get(deliveryId: string) {
        return mediaById.get(deliveryId);
      },
      text(deliveryId: string) {
        const media = mediaById.get(deliveryId);
        if (!media) return undefined;
        return new TextDecoder().decode(media.bytes);
      },
      objectUrl(deliveryId: string) {
        const existing = objectUrlById.get(deliveryId);
        if (existing) return existing;
        const media = mediaById.get(deliveryId);
        if (!media) return undefined;
        const objectUrl = URL.createObjectURL(
          new Blob([Uint8Array.from(media.bytes)], { type: media.mimeType }),
        );
        objectUrlById.set(deliveryId, objectUrl);
        return objectUrl;
      },
      download(delivery: WorkflowDelivery) {
        const objectUrl = this.objectUrl(delivery.deliveryId);
        if (!objectUrl) throw new TypeError("Delivery is no longer available");
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = delivery.name;
        anchor.click();
      },
      release,
      clear,
    }),
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
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension) return extension === "md" ? "markdown" : extension;
  if (file.type === "application/pdf") return "pdf";
  if (file.type === "text/csv") return "csv";
  return "unknown";
}

export function createSpecializedRunController(workflow: ToolWorkflow): Readonly<{
  runInteraction(
    toolId: string,
    format: string,
    mimeType: string,
    value: string,
  ): Promise<WorkflowOutcome | undefined>;
  runFile(toolId: string, file: BrowserFile): Promise<WorkflowOutcome | undefined>;
  runFiles(toolId: string, files: readonly BrowserFile[]): Promise<WorkflowOutcome | undefined>;
  scheduleInteraction(request: SpecializedInteractionRequest, delay?: number): void;
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
  const clear = () => {
    revision += 1;
    if (timer) clearTimeout(timer);
    timer = undefined;
    active?.abort();
    active = undefined;
  };

  return Object.freeze({
    async runInteraction(toolId, format, mimeType, value) {
      if (timer) clearTimeout(timer);
      timer = undefined;
      const run = begin();
      const outcome = await workflow.run({
        toolId,
        input: {
          kind: "interaction",
          interaction: {
            format,
            mimeType,
            value,
            bytes: new TextEncoder().encode(value).byteLength,
          },
        },
      }, { signal: run.controller.signal });
      return current(run.revision) ? outcome : undefined;
    },
    async runFile(toolId, file) {
      const run = begin();
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!current(run.revision)) return undefined;
      const outcome = await workflow.run({
        toolId,
        input: {
          kind: "file",
          media: { name: file.name, format: mediaFormat(file), mimeType: file.type, bytes },
        },
      }, { signal: run.controller.signal });
      return current(run.revision) ? outcome : undefined;
    },
    async runFiles(toolId, files) {
      const run = begin();
      const bytes = await Promise.all(files.map((file) => file.arrayBuffer()));
      if (!current(run.revision)) return undefined;
      const outcome = await workflow.run({
        toolId,
        input: {
          kind: "files",
          media: files.map((file, index) => ({
            name: file.name,
            format: mediaFormat(file),
            mimeType: file.type,
            bytes: new Uint8Array(bytes[index]!),
          })),
        },
      }, { signal: run.controller.signal });
      return current(run.revision) ? outcome : undefined;
    },
    scheduleInteraction(request, delay = 800) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void this.runInteraction(
          request.toolId,
          request.format,
          request.mimeType,
          request.value,
        );
      }, delay);
    },
    clear,
    dispose: clear,
  });
}
