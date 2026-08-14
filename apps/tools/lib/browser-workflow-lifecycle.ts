'use client';

import { beginToolRun } from './telemetry.ts';
import type {
  WorkflowDelivery,
  WorkflowMedia,
  WorkflowOutcome,
} from './tool-workflow/index.ts';

type TelemetryStart = Parameters<typeof beginToolRun>[0];
type TelemetryHandle = ReturnType<typeof beginToolRun>;

export function createBrowserWorkflowTelemetry<Request>(
  describe: (request: Request) => TelemetryStart,
  failureCode: (
    status: Exclude<WorkflowOutcome['status'], 'succeeded'>,
  ) => string = (status) => `workflow_${status}`,
): Readonly<{
  start(runId: string, request: Request): Promise<void>;
  terminal(runId: string, status: WorkflowOutcome['status']): Promise<void>;
}> {
  const handles = new Map<string, TelemetryHandle>();
  return Object.freeze({
    async start(runId, request) {
      handles.set(runId, beginToolRun(describe(request)));
    },
    async terminal(runId, status) {
      const handle = handles.get(runId);
      handles.delete(runId);
      if (!handle) return;
      if (status === 'succeeded') handle.finishSuccess({});
      else handle.finishFailure({ errorCode: failureCode(status) });
    },
  });
}

export type BrowserDeliveryStore = Readonly<{
  deliver(media: WorkflowMedia): Promise<string>;
  get(deliveryId: string): WorkflowMedia | undefined;
  text(deliveryId: string): string | undefined;
  objectUrl(deliveryId: string): string | undefined;
  download(delivery: WorkflowDelivery): void;
  release(deliveryId: string): void;
  clear(): void;
}>;

type BrowserDeliveryResource = Readonly<{
  objectUrl: string;
  click(name: string): void;
  release(): void;
}>;

type BrowserDeliveryResourcePorts = Readonly<{
  createBlob(parts: BlobPart[], options: BlobPropertyBag): Blob;
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
  clickDownload(url: string, name: string): void;
}>;

const browserDeliveryResourcePorts: BrowserDeliveryResourcePorts = {
  createBlob: (parts, options) => new Blob(parts, options),
  createObjectUrl: (blob) => URL.createObjectURL(blob),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  clickDownload(url, name) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
  },
};

function createBrowserDeliveryResource(
  media: WorkflowMedia,
  ports: BrowserDeliveryResourcePorts = browserDeliveryResourcePorts,
): BrowserDeliveryResource {
  const ownedBytes = media.bytes;
  const blobPart: BlobPart =
    ownedBytes.buffer instanceof ArrayBuffer
      ? (ownedBytes as Uint8Array<ArrayBuffer>)
      : new Uint8Array(ownedBytes);
  const objectUrl = ports.createObjectUrl(
    ports.createBlob([blobPart], { type: media.mimeType }),
  );
  let released = false;
  return Object.freeze({
    objectUrl,
    click(name) {
      if (released) throw new TypeError('Delivery is no longer available');
      ports.clickDownload(objectUrl, name);
    },
    release() {
      if (released) return;
      released = true;
      ports.revokeObjectUrl(objectUrl);
    },
  });
}

export function createBrowserDeliveryStore(
  options: Readonly<{
    idPrefix: string;
    isText?: (media: WorkflowMedia) => boolean;
  }>,
): BrowserDeliveryStore {
  const mediaById = new Map<string, WorkflowMedia>();
  const resourceById = new Map<string, BrowserDeliveryResource>();
  let sequence = 0;
  const release = (deliveryId: string) => {
    resourceById.get(deliveryId)?.release();
    resourceById.delete(deliveryId);
    mediaById.delete(deliveryId);
  };
  const clear = () => {
    for (const deliveryId of [...mediaById.keys()]) release(deliveryId);
  };
  const objectUrl = (deliveryId: string) => {
    const existing = resourceById.get(deliveryId);
    if (existing) return existing.objectUrl;
    const media = mediaById.get(deliveryId);
    if (!media) return undefined;
    const resource = createBrowserDeliveryResource(media);
    resourceById.set(deliveryId, resource);
    return resource.objectUrl;
  };
  return Object.freeze({
    async deliver(media) {
      clear();
      sequence += 1;
      const deliveryId = `${options.idPrefix}-${crypto.randomUUID()}-${sequence}`;
      mediaById.set(deliveryId, media);
      return deliveryId;
    },
    get(deliveryId) {
      return mediaById.get(deliveryId);
    },
    text(deliveryId) {
      const media = mediaById.get(deliveryId);
      if (!media || (options.isText && !options.isText(media)))
        return undefined;
      return new TextDecoder().decode(media.bytes);
    },
    objectUrl,
    download(delivery) {
      objectUrl(delivery.deliveryId);
      const resource = resourceById.get(delivery.deliveryId);
      if (!resource) throw new TypeError('Delivery is no longer available');
      try {
        resource.click(delivery.name);
      } catch (error) {
        release(delivery.deliveryId);
        throw error;
      }
    },
    release,
    clear,
  });
}

export type BrowserDownloadPorts = Readonly<{
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
  clickDownload(url: string, name: string): void;
  scheduleCleanup(callback: () => void, delayMs: number): void;
  nextId(): string;
}>;

const browserDownloadPorts: BrowserDownloadPorts = {
  createObjectUrl: (blob) => URL.createObjectURL(blob),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  clickDownload(url, name) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
  },
  scheduleCleanup(callback, delayMs) {
    setTimeout(callback, delayMs);
  },
  nextId: () => crypto.randomUUID(),
};

export async function deliverBrowserMedia(
  media: WorkflowMedia,
  ports: BrowserDownloadPorts = browserDownloadPorts,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const resource = createBrowserDeliveryResource(media, {
    createBlob: browserDeliveryResourcePorts.createBlob,
    createObjectUrl: ports.createObjectUrl,
    revokeObjectUrl: ports.revokeObjectUrl,
    clickDownload: ports.clickDownload,
  });
  try {
    if (signal) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          reject(
            signal.reason ??
              new DOMException('The operation was aborted', 'AbortError'),
          );
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, 0);
        signal.addEventListener('abort', onAbort, { once: true });
      });
      signal.throwIfAborted();
    }
    resource.click(media.name);
    ports.scheduleCleanup(resource.release, 1_000);
  } catch (error) {
    resource.release();
    throw error;
  }
  return ports.nextId();
}

type DirectDeliveryPorts = {
  releaseOwnership?: boolean;
  createBlob?(parts: BlobPart[], options: BlobPropertyBag): Blob;
  createObjectURL?(blob: Blob): string;
  revokeObjectURL?(url: string): void;
  createAnchor?(): Pick<HTMLAnchorElement, 'href' | 'download' | 'click'>;
  schedule?(cleanup: () => void): void;
};

export function deliverMediaInBrowser(
  media: WorkflowMedia,
  ports: DirectDeliveryPorts = {},
): void {
  const resource = createBrowserDeliveryResource(media, {
    createBlob: ports.createBlob ?? browserDeliveryResourcePorts.createBlob,
    createObjectUrl:
      ports.createObjectURL ?? browserDeliveryResourcePorts.createObjectUrl,
    revokeObjectUrl:
      ports.revokeObjectURL ?? browserDeliveryResourcePorts.revokeObjectUrl,
    clickDownload(url, name) {
      const anchor = ports.createAnchor?.() ?? document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.click();
    },
  });
  if (ports.releaseOwnership) media.bytes = new Uint8Array(0);
  try {
    resource.click(media.name);
    if (ports.schedule) ports.schedule(resource.release);
    else setTimeout(resource.release, 1_000);
  } catch (error) {
    resource.release();
    throw error;
  }
}

export function createLatestAsyncReader<Input, Output>(
  readInput: (input: Input) => Promise<Output>,
): Readonly<{
  read(input: Input): Promise<Output | undefined>;
  invalidate(): void;
}> {
  let revision = 0;
  return Object.freeze({
    async read(input) {
      revision += 1;
      const readRevision = revision;
      const output = await readInput(input);
      return readRevision === revision ? output : undefined;
    },
    invalidate() {
      revision += 1;
    },
  });
}
