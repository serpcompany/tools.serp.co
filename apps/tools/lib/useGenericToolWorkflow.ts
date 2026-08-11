"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ToolProgressFile } from "@/components/ToolProgressIndicator";
import {
  getGenericToolContract,
  runGenericToolFile,
} from "@/lib/generic-tool-workflow";
import type { WorkflowFailure, WorkflowSnapshot } from "@/lib/tool-workflow";

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
  const abortRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [adsVisible, setAdsVisible] = useState(false);
  const [currentFile, setCurrentFile] = useState<ToolProgressFile | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const runFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length || busy) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setAdsVisible(true);
      setBusy(true);
      args.onStart?.();
      const contract = getGenericToolContract(args.toolId);

      try {
        for (const file of Array.from(files)) {
          const observe = (snapshot: WorkflowSnapshot) => {
            if (
              snapshot.phase === "failed" ||
              snapshot.phase === "cancelled" ||
              snapshot.phase === "succeeded"
            ) {
              return;
            }
            setCurrentFile({
              name: file.name,
              progress: Math.round((snapshot.progress ?? 0) * 100),
              status:
                snapshot.phase === "acquiring" ? "loading" : "processing",
              message:
                snapshot.phase === "acquiring" ? "Reading file…" : undefined,
            });
          };
          setCurrentFile({
            name: file.name,
            progress: 0,
            status: "loading",
            message: "Reading file…",
          });
          const outcome = await runGenericToolFile(args.toolId, file, {
            signal: controller.signal,
            observe,
          });
          if (outcome.status === "succeeded") {
            setCurrentFile({
              name: file.name,
              progress: 100,
              status: "completed",
              message:
                contract.state === "supported" &&
                contract.operation === "compress"
                  ? "Compression complete!"
                  : "Conversion complete!",
            });
          } else if (outcome.status === "failed") {
            setCurrentFile({
              name: file.name,
              progress: 0,
              status: "error",
              message: userSafeFailure(outcome.error),
            });
          }
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setBusy(false);
      }
    },
    [args, busy],
  );

  return { adsVisible, busy, currentFile, runFiles };
}
