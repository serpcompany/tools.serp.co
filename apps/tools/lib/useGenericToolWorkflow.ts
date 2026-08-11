"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ToolProgressFile } from "@/components/ToolProgressIndicator";
import {
  getGenericToolContract,
  runGenericToolFile,
} from "@/lib/generic-tool-workflow";
import type { WorkflowFailure } from "@/lib/tool-workflow";
import { createGenericToolRunController } from "@/lib/generic-tool-run-controller";

function userSafeFailure(failure: WorkflowFailure): string {
  if (failure.code === "unsupported-tool" || failure.code === "unsupported-request") {
    return "This conversion is not currently supported.";
  }
  if (failure.code === "invalid-request") {
    return "This file is not a valid supported input.";
  }
  return "The file could not be processed safely. Please try another file.";
}

export function useGenericToolWorkflow(args: {
  toolId: string;
  onStart?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [adsVisible, setAdsVisible] = useState(false);
  const [currentFile, setCurrentFile] = useState<ToolProgressFile | null>(null);

  const controllerRef = useRef<ReturnType<typeof createGenericToolRunController> | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createGenericToolRunController({
      runFile: runGenericToolFile,
      publish(patch) {
        if (patch.adsVisible !== undefined) setAdsVisible(patch.adsVisible);
        if (patch.busy !== undefined) setBusy(patch.busy);
        if (patch.currentFile !== undefined) setCurrentFile(patch.currentFile);
      },
      failureMessage: userSafeFailure,
      completionMessage(toolId) {
        const contract = getGenericToolContract(toolId);
        return contract.state === "supported" && contract.operation === "compress"
          ? "Compression complete!"
          : "Conversion complete!";
      },
    });
  }

  useEffect(() => () => controllerRef.current?.cancel(), []);

  const runFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      await controllerRef.current?.run({
        toolId: args.toolId,
        files: Array.from(files),
        onStart: args.onStart,
      });
    },
    [args.toolId, args.onStart],
  );

  return { adsVisible, busy, currentFile, runFiles };
}
