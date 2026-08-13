import type { ToolFactoryRow } from './tool-factory-read-model.ts';

export function journeyEvidenceLabel(
  state: ToolFactoryRow['verificationEvidence'][number]['state'],
) {
  return {
    verified: 'Verified journey',
    incomplete: 'Passed checks · evidence incomplete',
    failed: 'Failed controlled run',
    warned: 'Warning · not verified',
    skipped: 'Skipped · not verified',
    stale: 'Stale evidence',
    invalid: 'Invalid evidence',
    'no-evidence': 'No retained evidence',
  }[state];
}
