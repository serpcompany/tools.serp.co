"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createBrowserSpecializedWorkflow,
  createSpecializedRunController,
  type BrowserFile,
} from "./specialized-browser-workflow.ts";
import type { WorkflowDelivery, WorkflowOutcome, WorkflowSnapshot } from "./tool-workflow/index.ts";

function failureMessage(outcome: WorkflowOutcome | undefined): string | undefined {
  return outcome?.status === "failed" ? outcome.error.message : undefined;
}

export function useSpecializedToolWorkflow() {
  const [{ workflow, deliveries }] = useState(createBrowserSpecializedWorkflow);
  const [controller] = useState(() => createSpecializedRunController(workflow));
  const [outcome, setOutcome] = useState<WorkflowOutcome>();
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    controller.dispose();
    deliveries.clear();
  }, [controller, deliveries]);

  const accept = useCallback((next: WorkflowOutcome | undefined) => {
    if (next) setOutcome(next);
    return next;
  }, []);

  const runInteraction = useCallback(async (
    toolId: string,
    format: string,
    mimeType: string,
    value: string,
  ) => {
    deliveries.clear();
    setSnapshot({ phase: "acquiring" });
    const next = await controller.runInteraction(toolId, format, mimeType, value);
    if (next) setSnapshot({ phase: next.status });
    return accept(next);
  }, [accept, controller, deliveries]);

  const scheduleInteraction = useCallback((
    toolId: string,
    format: string,
    mimeType: string,
    value: string,
    delay = 800,
  ) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void runInteraction(toolId, format, mimeType, value);
    }, delay);
  }, [runInteraction]);

  const runFile = useCallback(async (toolId: string, file: BrowserFile) => {
    deliveries.clear();
    setSnapshot({ phase: "acquiring" });
    const next = await controller.runFile(toolId, file);
    if (next) setSnapshot({ phase: next.status });
    return accept(next);
  }, [accept, controller, deliveries]);

  const runFiles = useCallback(async (toolId: string, files: readonly BrowserFile[]) => {
    deliveries.clear();
    setSnapshot({ phase: "acquiring" });
    const next = await controller.runFiles(toolId, files);
    if (next) setSnapshot({ phase: next.status });
    return accept(next);
  }, [accept, controller, deliveries]);

  const clear = useCallback(() => {
    controller.dispose();
    deliveries.clear();
    setOutcome(undefined);
    setSnapshot(undefined);
  }, [controller, deliveries]);

  return useMemo(() => Object.freeze({
    outcome,
    snapshot,
    error: failureMessage(outcome),
    busy: snapshot ? !["succeeded", "failed", "cancelled"].includes(snapshot.phase) : false,
    delivery: outcome?.status === "succeeded" ? outcome.results[0] : undefined,
    text(delivery: WorkflowDelivery | undefined) {
      return delivery ? deliveries.text(delivery.deliveryId) : undefined;
    },
    objectUrl(delivery: WorkflowDelivery | undefined) {
      return delivery ? deliveries.objectUrl(delivery.deliveryId) : undefined;
    },
    download(delivery: WorkflowDelivery | undefined) {
      if (delivery) deliveries.download(delivery);
    },
    runInteraction,
    scheduleInteraction,
    runFile,
    runFiles,
    clear,
  }), [clear, deliveries, outcome, runFile, runFiles, runInteraction, scheduleInteraction, snapshot]);
}
