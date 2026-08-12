import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { buildToolExpansionGapReadModel } from './build-tool-expansion-gap.mjs';
import { renderToolExpansionGapReport } from './tool-expansion-gap-report.mjs';

test('report is deterministic, indexed, and keeps evidence scope and planning caveats explicit', () => {
  const revision = 'd3e6c4c44af0d0a6a8e243f4a4e61963bb838e87';
  const projection = buildToolExpansionGapReadModel({
    baselineRevision: revision,
    reproducerSourceRevision: '8413e508494c345f42ccebdd50f713e3aa1af4df',
  }).toProjection();
  const first = renderToolExpansionGapReport(projection);
  const second = renderToolExpansionGapReport(projection);

  assert.equal(first, second);
  assert.match(first, /2,807 active Tool ids/);
  assert.match(
    first,
    /431 supported \| 2,373 unsupported \| 0 unwired \| 3 unknown/,
  );
  assert.match(first, /Conversion gaps \| 2,353/);
  assert.match(first, /Compression gaps \| 20/);
  assert.match(first, /JSON pointer/);
  assert.match(first, /browser-raster-exact-capability.*29/s);
  assert.match(first, /Production was not queried/);
  assert.match(first, /Planning assumptions are not measured evidence/);
  assert.doesNotMatch(first, /generated at/i);
  const retainedHistoricalReport = fs.readFileSync(
    new URL(
      '../../docs/audits/tool-processor-expansion-gap-2026-08-12.md',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(
    retainedHistoricalReport,
    /426 supported \| 2,378 unsupported \| 0 unwired \| 3 unknown/,
  );
  assert.notEqual(retainedHistoricalReport, first);
});
