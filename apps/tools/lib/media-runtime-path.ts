import type { ToolRuntimePath } from './tool-runtime-observations.ts';
import { toolJourneys } from './tool-journeys.ts';

export function classifyMediaRuntimePath(
  toolId: string,
  input:
    | Readonly<{ kind: 'file' }>
    | Readonly<{ kind: 'url'; url: string }>
    | Readonly<{ kind: string }>,
): ToolRuntimePath {
  return toolJourneys.resolveInput(toolId, input)?.input.runtimePath ?? 'other';
}
