import type { ToolProgressFile } from "../../components/ToolProgressIndicator.tsx";
import type { WorkflowPhase, WorkflowSnapshot } from "../tool-workflow/index.ts";
import type { BrowserRunLease } from "./browser-run-ownership.ts";
import { createMonotonicProgress } from "./monotonic-progress.ts";
import type { MediaTransferProgress } from "./media-endpoint.ts";
import { projectMediaTransfer } from "./transfer-presentation.ts";

type ActiveWorkflowPhase = Exclude<
  WorkflowPhase,
  "succeeded" | "failed" | "cancelled"
>;

export function createBrowserRunProgress(options: {
  lease: BrowserRunLease;
  name: string;
  messages: Readonly<Record<ActiveWorkflowPhase, string>>;
}) {
  const progress = createMonotonicProgress();
  const project = (
    value: number | undefined,
    status: ToolProgressFile["status"],
    message: string,
  ): ToolProgressFile | undefined => {
    if (!options.lease.isCurrent()) return undefined;
    return {
      name: options.name,
      progress: progress.project(value),
      status,
      message,
    };
  };

  return Object.freeze({
    fromTransfer(transfer: MediaTransferProgress) {
      const presentation = projectMediaTransfer(transfer);
      return project(presentation.progress, "loading", presentation.message);
    },
    fromSnapshot(snapshot: WorkflowSnapshot) {
      if (
        snapshot.phase === "succeeded" ||
        snapshot.phase === "failed" ||
        snapshot.phase === "cancelled"
      ) {
        return undefined;
      }
      return project(
        snapshot.progress === undefined ? undefined : snapshot.progress * 100,
        snapshot.phase === "acquiring" ? "loading" : "processing",
        options.messages[snapshot.phase],
      );
    },
    fromError(message: string) {
      return project(undefined, "error", message);
    },
  });
}
