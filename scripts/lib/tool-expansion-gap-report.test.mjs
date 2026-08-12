import assert from 'node:assert/strict';
import test from 'node:test';

import { buildToolExpansionGapReadModel } from './build-tool-expansion-gap.mjs';
import { renderToolExpansionGapReport } from './tool-expansion-gap-report.mjs';

test('report is deterministic, indexed, and keeps evidence scope and planning caveats explicit', () => {
  const revision = 'd3e6c4c44af0d0a6a8e243f4a4e61963bb838e87';
  const projection = buildToolExpansionGapReadModel({
    baselineRevision: revision,
  }).toProjection();
  const first = renderToolExpansionGapReport(projection);
  const second = renderToolExpansionGapReport(projection);

  assert.equal(first, second);
  assert.match(first, /2,807 active Tool ids/);
  assert.match(
    first,
    /426 supported \| 2,378 unsupported \| 0 unwired \| 3 unknown/,
  );
  assert.match(first, /Conversion gaps \| 2,358/);
  assert.match(first, /Compression gaps \| 20/);
  assert.match(first, /JSON pointer/);
  assert.match(first, /browser-raster-exact-capability.*34/s);
  assert.match(first, /Production was not queried/);
  assert.match(first, /Planning assumptions are not measured evidence/);
  assert.doesNotMatch(first, /generated at/i);
});
