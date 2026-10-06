export type ToolRunEventType =
  | "tool_run_started"
  | "tool_run_succeeded"
  | "tool_run_failed"
  // The tool sent the visitor elsewhere (e.g. the browser extension) instead
  // of attempting the job. Not a failure.
  | "tool_run_handed_off"
  // The page closed or navigated away before the run finished.
  | "tool_run_abandoned";

export type ToolRunStatus = "started" | "succeeded" | "failed" | "handed_off" | "abandoned";

export type ToolRunEvent = {
  event: ToolRunEventType;
  runId: string;
  toolId: string;
  from?: string;
  to?: string;
  startedAt: string;
  durationMs?: number;
  inputBytes?: number;
  outputBytes?: number;
  errorCode?: string;
  metadata?: Record<string, unknown>;
};

export type ToolRunRecord = {
  toolId: string;
  status: ToolRunStatus;
  startedAt: Date;
  durationMs?: number | null;
  inputBytes?: number | null;
  outputBytes?: number | null;
  errorCode?: string | null;
  metadata?: Record<string, unknown> | null;
};
