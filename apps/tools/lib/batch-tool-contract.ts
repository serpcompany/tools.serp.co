const TOOL_ID = 'batch-compress-png';

export type BatchToolContract =
  | Readonly<{
      state: 'supported';
      toolId: typeof TOOL_ID;
      adapterId: 'browser-batch-png-workflow';
      primaryOperation: Readonly<{
        class: 'library';
        identity: '@jsquash/oxipng 1 and @zip.js/zip.js 2';
        rationale: string;
      }>;
    }>
  | Readonly<{ state: 'unsupported'; toolId: string; reason: string }>;

const contract = Object.freeze({
  state: 'supported' as const,
  toolId: TOOL_ID,
  adapterId: 'browser-batch-png-workflow' as const,
  primaryOperation: Object.freeze({
    class: 'library' as const,
    identity: '@jsquash/oxipng 1 and @zip.js/zip.js 2' as const,
    rationale:
      'Oxipng owns PNG compression and zip.js owns ordered ZIP encoding and decoding; repository policy only bounds and validates the batch.',
  }),
});

export function getBatchToolContract(toolId: string): BatchToolContract {
  return toolId === TOOL_ID
    ? contract
    : Object.freeze({
        state: 'unsupported' as const,
        toolId,
        reason:
          'No batch shared-workflow processor is registered for this Tool id.',
      });
}
