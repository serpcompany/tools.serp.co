import { toolCatalog } from '@serp-tools/app-core/lib/tool-catalog';

import {
  getEligibleTableToolIds,
  TABLE_PROCESSOR_ADAPTER_ID,
} from './table-operation-policy.ts';
import { getToolExecutionProvenance } from './tool-execution-provenance.ts';
import { getGenericToolContract } from './generic-tool-workflow.ts';
import { getMediaWorkflowAdapterRegistration } from './media-workflow/adapter-registration.ts';
import { SPECIALIZED_TOOL_IDS } from './specialized-tool-policy.ts';

export type WiredToolProcessorAvailability = Readonly<{
  kind: 'wired';
  toolId: string;
  adapterId: string;
}>;

export type UnwiredToolProcessorAvailability = Readonly<{
  kind: 'unwired';
  toolId: string;
  reason: string;
  sourceNeeded: string;
}>;

export type UnknownToolProcessorAvailability = Readonly<{
  kind: 'unknown';
  toolId: string;
  reason: string;
  sourceNeeded: string;
}>;

export type ToolProcessorAvailability =
  | WiredToolProcessorAvailability
  | UnwiredToolProcessorAvailability
  | UnknownToolProcessorAvailability;

const registeredAdapterIdByToolId: Readonly<Record<string, string>> =
  Object.freeze(
    Object.fromEntries(
      getEligibleTableToolIds().map((toolId) => [
        toolId,
        TABLE_PROCESSOR_ADAPTER_ID,
      ]).concat(
        SPECIALIZED_TOOL_IDS.map((toolId) => [
          toolId,
          'browser-specialized-workflow',
        ]),
      ),
    ),
  );

function availabilityForToolId(toolId: string): ToolProcessorAvailability {
  const tableAdapterId = registeredAdapterIdByToolId[toolId];
  if (tableAdapterId) {
    return Object.freeze({
      kind: 'wired',
      toolId,
      adapterId: tableAdapterId,
    });
  }

  const mediaRegistration = getMediaWorkflowAdapterRegistration(toolId);
  if (mediaRegistration) {
    return Object.freeze({
      kind: 'wired',
      toolId,
      adapterId: mediaRegistration.adapterId,
    });
  }
  const genericContract = getGenericToolContract(toolId);
  if (genericContract.state === 'supported') {
    return Object.freeze({
      kind: 'wired',
      toolId,
      adapterId: genericContract.adapterId,
    });
  }

  const provenance = getToolExecutionProvenance(toolId);
  if (provenance.kind === 'unknown') {
    return Object.freeze({
      kind: 'unknown',
      toolId,
      reason: provenance.reason,
      sourceNeeded: provenance.sourceNeeded,
    });
  }

  return Object.freeze({
    kind: 'unwired',
    toolId,
    reason:
      'Execution provenance is known, but no processor adapter is registered for the shared workflow.',
    sourceNeeded:
      'Register a processor adapter only when this Tool family migrates to the shared workflow.',
  });
}

const availabilityByToolId = new Map<string, ToolProcessorAvailability>(
  toolCatalog.tools.map((tool) => [tool.id, availabilityForToolId(tool.id)]),
);

export function getToolProcessorAvailability(
  toolId: string,
): ToolProcessorAvailability {
  return (
    availabilityByToolId.get(toolId) ??
    Object.freeze({
      kind: 'unknown',
      toolId,
      reason: 'The Tool id is not present in the Tool Catalog.',
      sourceNeeded:
        'Add or correct the canonical Tool id before registering a processor adapter.',
    })
  );
}

export const toolProcessorRegistry = Object.freeze({
  getByToolId: getToolProcessorAvailability,
});
