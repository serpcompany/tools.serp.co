"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createBrowserSpecializedWorkflow,
  createSpecializedRunController,
  type BrowserFile,
  type SpecializedInteractionRequest,
} from "./specialized-browser-workflow.ts";
import type { WorkflowDelivery, WorkflowOutcome, WorkflowSnapshot } from "./tool-workflow/index.ts";

function failureMessage(outcome: WorkflowOutcome | undefined): string | undefined {
  return outcome?.status === "failed" ? outcome.error.message : undefined;
}

export function useSpecializedToolWorkflow() {
  const [{ workflow, deliveries }] = useState(createBrowserSpecializedWorkflow);
  const [outcome, setOutcome] = useState<WorkflowOutcome>();
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot>();
  const [controller] = useState(() => createSpecializedRunController(workflow, {
    observe: setSnapshot,
    onOutcome: setOutcome,
  }));

  useEffect(() => () => {
    controller.dispose();
    deliveries.clear();
  }, [controller, deliveries]);

  const runInteraction = useCallback(async (request: SpecializedInteractionRequest) => {
    deliveries.clear();
    return controller.runInteraction(request);
  }, [controller, deliveries]);

  const scheduleInteraction = useCallback((
    request: SpecializedInteractionRequest,
    delay = 800,
  ) => {
    deliveries.clear();
    controller.scheduleInteraction(request, delay);
  }, [controller, deliveries]);

  const runFile = useCallback(async (toolId: string, file: BrowserFile) => {
    deliveries.clear();
    return controller.runFile(toolId, file);
  }, [controller, deliveries]);

  const runFiles = useCallback(async (toolId: string, files: readonly BrowserFile[]) => {
    deliveries.clear();
    return controller.runFiles(toolId, files);
  }, [controller, deliveries]);

  const clear = useCallback(() => {
    controller.clear();
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
