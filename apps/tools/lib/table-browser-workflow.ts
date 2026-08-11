"use client";

import { beginToolRun } from "@/lib/telemetry";

import {
  browserTableRasterizer,
  browserTableRasterVerifier,
  createTableToolWorkflow,
} from "./table-tool-processors.ts";
import type { WorkflowDelivery, WorkflowMedia } from "./tool-workflow/index.ts";

type TelemetryHandle = ReturnType<typeof beginToolRun>;

export type BrowserTableDeliveries = Readonly<{
  get(deliveryId: string): WorkflowMedia | undefined;
  download(delivery: WorkflowDelivery): void;
}>;

export function createBrowserTableWorkflow(): Readonly<{
  workflow: ReturnType<typeof createTableToolWorkflow>;
  deliveries: BrowserTableDeliveries;
}> {
  const mediaByDeliveryId = new Map<string, WorkflowMedia>();
  const telemetryByRunId = new Map<string, TelemetryHandle>();

  let sequence = 0;
  const workflow = createTableToolWorkflow({
    rasterize: browserTableRasterizer,
    verifyRaster: browserTableRasterVerifier,
    nextId(kind) {
      sequence += 1;
      return `${kind}-${crypto.randomUUID()}-${sequence}`;
    },
    async deliver(media) {
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
      download(delivery: WorkflowDelivery) {
        const media = mediaByDeliveryId.get(delivery.deliveryId);
        if (!media)
          throw new TypeError("Table delivery is no longer available");
        const anchor = document.createElement("a");
        anchor.href = URL.createObjectURL(
          new Blob([Uint8Array.from(media.bytes)], { type: media.mimeType }),
        );
        anchor.download = media.name;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(anchor.href), 1_000);
      },
    }),
  });
}
