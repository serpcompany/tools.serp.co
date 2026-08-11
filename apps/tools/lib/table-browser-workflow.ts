"use client";

import { beginToolRun } from "./telemetry.ts";

import {
  browserTableRasterizer,
  browserTableRasterVerifier,
  createTableToolWorkflow,
} from "./table-tool-processors.ts";
import type { WorkflowDelivery, WorkflowMedia } from "./tool-workflow/index.ts";

type TelemetryHandle = ReturnType<typeof beginToolRun>;

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
  const mediaByDeliveryId = new Map<string, WorkflowMedia>();
  const objectUrlsByDeliveryId = new Map<string, Set<string>>();
  const telemetryByRunId = new Map<string, TelemetryHandle>();

  const release = (deliveryId: string) => {
    for (const objectUrl of objectUrlsByDeliveryId.get(deliveryId) ?? []) {
      URL.revokeObjectURL(objectUrl);
    }
    objectUrlsByDeliveryId.delete(deliveryId);
    mediaByDeliveryId.delete(deliveryId);
  };
  const clear = () => {
    for (const deliveryId of [...mediaByDeliveryId.keys()]) {
      release(deliveryId);
    }
  };

  let sequence = 0;
  const workflow = createTableToolWorkflow({
    rasterize: browserTableRasterizer,
    verifyRaster: browserTableRasterVerifier,
    nextId(kind) {
      sequence += 1;
      return `${kind}-${crypto.randomUUID()}-${sequence}`;
    },
    async deliver(media) {
      clear();
      const deliveryId = `table-delivery-${crypto.randomUUID()}`;
      mediaByDeliveryId.set(deliveryId, media);
      return deliveryId;
    },
    telemetry: {
      async start(runId, request) {
        const media =
          request.input.kind === "file" ? request.input.media : undefined;
        telemetryByRunId.set(
          runId,
          beginToolRun({
            toolId: request.toolId,
            from: media?.format,
            inputBytes: media?.bytes.byteLength,
          }),
        );
      },
      async terminal(runId, status) {
        const telemetry = telemetryByRunId.get(runId);
        telemetryByRunId.delete(runId);
        if (!telemetry) return;
        if (status === "succeeded") {
          telemetry.finishSuccess({});
        } else {
          telemetry.finishFailure({ errorCode: `workflow_${status}` });
        }
      },
    },
  });

  return Object.freeze({
    workflow,
    deliveries: Object.freeze({
      get(deliveryId: string) {
        return mediaByDeliveryId.get(deliveryId);
      },
      text(deliveryId: string) {
        const media = mediaByDeliveryId.get(deliveryId);
        if (
          !media ||
          (!media.mimeType.startsWith("text/") &&
            ![
              "application/json",
              "application/sql",
              "application/x-ndjson",
              "application/xml",
              "application/yaml",
            ].includes(media.mimeType))
        ) {
          return undefined;
        }
        return new TextDecoder().decode(media.bytes);
      },
      download(delivery: WorkflowDelivery) {
        const media = mediaByDeliveryId.get(delivery.deliveryId);
        if (!media)
          throw new TypeError("Table delivery is no longer available");
        const anchor = document.createElement("a");
        const objectUrl = URL.createObjectURL(
          new Blob([Uint8Array.from(media.bytes)], { type: media.mimeType }),
        );
        anchor.href = objectUrl;
        anchor.download = media.name;
        anchor.click();
        const objectUrls =
          objectUrlsByDeliveryId.get(delivery.deliveryId) ?? new Set<string>();
        objectUrls.add(objectUrl);
        objectUrlsByDeliveryId.set(delivery.deliveryId, objectUrls);
        window.setTimeout(() => {
          URL.revokeObjectURL(objectUrl);
          objectUrls.delete(objectUrl);
          if (objectUrls.size === 0)
            objectUrlsByDeliveryId.delete(delivery.deliveryId);
        }, 1_000);
      },
      release,
      clear,
    }),
  });
}
