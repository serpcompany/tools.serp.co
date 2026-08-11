import type { ToolProgressFile } from "@/components/ToolProgressIndicator";
import type { WorkflowFailure, WorkflowOutcome, WorkflowSnapshot } from "./tool-workflow/index.ts";

export type GenericRunState = Readonly<{
  adsVisible: boolean;
  busy: boolean;
  currentFile: ToolProgressFile | null;
}>;

type RunFile = (
  toolId: string,
  file: File,
  options: Readonly<{ signal: AbortSignal; observe(snapshot: WorkflowSnapshot): void }>,
) => Promise<WorkflowOutcome>;

export function createGenericToolRunController(dependencies: Readonly<{
  runFile: RunFile;
  publish(patch: Partial<GenericRunState>): void;
  failureMessage(failure: WorkflowFailure): string;
  completionMessage(toolId: string): string;
}>) {
  let current: AbortController | null = null;
  return {
    cancel() {
      current?.abort();
      current = null;
    },
    async run(request: Readonly<{
      toolId: string;
      files: readonly File[];
      onStart?: () => void;
    }>) {
      if (request.files.length === 0) return;
      current?.abort();
      const controller = new AbortController();
      current = controller;
      const publish = (patch: Partial<GenericRunState>) => {
        if (current === controller) dependencies.publish(patch);
      };
      publish({ adsVisible: true, busy: true });
      request.onStart?.();
      try {
        for (const file of request.files) {
          publish({
            currentFile: {
              name: file.name,
              progress: 0,
              status: "loading",
              message: "Reading file…",
            },
          });
          const outcome = await dependencies.runFile(request.toolId, file, {
            signal: controller.signal,
            observe(snapshot) {
              if (["failed", "cancelled", "succeeded"].includes(snapshot.phase)) return;
              publish({
                currentFile: {
                  name: file.name,
                  progress: Math.round((snapshot.progress ?? 0) * 100),
                  status: snapshot.phase === "acquiring" ? "loading" : "processing",
                  message: snapshot.phase === "acquiring" ? "Reading file…" : undefined,
                },
              });
            },
          });
          if (outcome.status === "succeeded") {
            publish({
              currentFile: {
                name: file.name,
                progress: 100,
                status: "completed",
                message: dependencies.completionMessage(request.toolId),
              },
            });
          } else if (outcome.status === "failed") {
            publish({
              currentFile: {
                name: file.name,
                progress: 0,
                status: "error",
                message: dependencies.failureMessage(outcome.error),
              },
            });
          }
        }
      } finally {
        if (current === controller) {
          current = null;
          dependencies.publish({ busy: false });
        }
      }
    },
  };
}
