import { beginToolRun } from "../telemetry.ts";
import type { ToolWorkflow, WorkflowMedia } from "../tool-workflow/index.ts";
import { createMediaWorkflow } from "./index.ts";
import { createProductionMediaEndpoint } from "./media-endpoint.ts";
import { getExtensionFromName, safeMediaName } from "./media-endpoint.ts";
import type { MediaTransferProgress } from "./media-endpoint.ts";
import type { TranscriptionPort } from "./processors.ts";

export async function workflowMediaFromFile(
  file: File,
): Promise<WorkflowMedia> {
  const format = getExtensionFromName(file.name);
  if (!format)
    throw new Error("The selected file needs a supported extension.");
  return {
    name: safeMediaName(file.name, "https://local.invalid/media", format),
    format,
    mimeType: file.type.trim().toLowerCase() || "application/octet-stream",
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}

type BrowserDeliveryPorts = {
  releaseOwnership?: boolean;
  createBlob?(parts: BlobPart[], options: BlobPropertyBag): Blob;
  createObjectURL?(blob: Blob): string;
  revokeObjectURL?(url: string): void;
  createAnchor?(): Pick<HTMLAnchorElement, "href" | "download" | "click">;
  schedule?(cleanup: () => void): void;
};

export function deliverMediaInBrowser(
  media: WorkflowMedia,
  ports: BrowserDeliveryPorts = {},
): void {
  const ownedBytes = media.bytes;
  const blobPart: BlobPart =
    ownedBytes.buffer instanceof ArrayBuffer
      ? (ownedBytes as Uint8Array<ArrayBuffer>)
      : new Uint8Array(ownedBytes);
  const blob = (
    ports.createBlob ?? ((parts, options) => new Blob(parts, options))
  )([blobPart], { type: media.mimeType });
  if (ports.releaseOwnership) {
    media.bytes = new Uint8Array(0);
  }
  const createObjectURL =
    ports.createObjectURL ?? URL.createObjectURL.bind(URL);
  const revokeObjectURL =
    ports.revokeObjectURL ?? URL.revokeObjectURL.bind(URL);
  const objectUrl = createObjectURL(blob);
  const cleanup = () => revokeObjectURL(objectUrl);
  if (ports.schedule) ports.schedule(cleanup);
  else setTimeout(cleanup, 1_000);
  const anchor = ports.createAnchor?.() ?? document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = media.name;
  anchor.click();
}

export function createBrowserMediaWorkflow(
  options: {
    onDelivered?(media: WorkflowMedia): void;
    onTransfer?(progress: MediaTransferProgress): void;
    releaseDeliveredBytes?: boolean;
    transcription?: TranscriptionPort;
  } = {},
): ToolWorkflow {
  let id = 0;
  const telemetryHandles = new Map<string, ReturnType<typeof beginToolRun>>();
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
    telemetry: {
      async start(runId, request) {
        const from =
          request.input.kind === "url" ? "url" : request.input.media.format;
        const to =
          request.toolId.includes("transcript") ||
          request.toolId === "audio-to-text"
            ? "txt"
            : request.options &&
                typeof request.options === "object" &&
                "mode" in request.options &&
                (request.options as { mode?: unknown }).mode === "audio"
              ? "audio"
              : "video";
        telemetryHandles.set(
          runId,
          beginToolRun({
            toolId: request.toolId,
            from,
            to,
            inputBytes:
              request.input.kind === "file"
                ? request.input.media.bytes.byteLength
                : undefined,
            metadata: { source: request.input.kind },
          }),
        );
      },
      async terminal(runId, status) {
        const handle = telemetryHandles.get(runId);
        telemetryHandles.delete(runId);
        if (!handle) return;
        if (status === "succeeded") handle.finishSuccess({});
        else
          handle.finishFailure({
            errorCode: status === "cancelled" ? "cancelled" : "workflow_failed",
          });
      },
    },
    clock: { now: () => performance.now() },
    nextId(kind) {
      id += 1;
      return `${kind}-${id}`;
    },
  });
}
