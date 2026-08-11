import { getToolExecutionProvenance } from "../tool-execution-provenance.ts";

export function isStreamedMediaDownloaderTool(toolId: string): boolean {
  const provenance = getToolExecutionProvenance(toolId);
  return (
    provenance.kind === "mapped" &&
    provenance.engineIds.length === 1 &&
    provenance.engineIds[0] === "server-media-fetch"
  );
}
