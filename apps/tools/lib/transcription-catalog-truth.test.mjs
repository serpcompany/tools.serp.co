import assert from 'node:assert/strict';
import test from 'node:test';

import { toolCatalog } from '../../../packages/app-core/src/lib/tool-catalog.ts';
import { TRANSCRIPTION_TOOL_IDS } from './media-workflow/tool-family.ts';

test('every registered transcription page truthfully rejects YouTube links', () => {
  for (const toolId of TRANSCRIPTION_TOOL_IDS) {
    const page = toolCatalog.getPageContent(toolId);
    assert.ok(page, `${toolId} must have rendered page content`);

    const renderedCopy = JSON.stringify(page);
    assert.match(
      renderedCopy,
      /YouTube links are not supported right now/,
      `${toolId} must state the YouTube limitation`,
    );
    assert.doesNotMatch(
      renderedCopy,
      /Yes for public links|uploads? or public links|public links or uploads?|paste a public link|Handles uploads or public links/i,
      `${toolId} must not imply arbitrary webpage-link support`,
    );
  }
});
