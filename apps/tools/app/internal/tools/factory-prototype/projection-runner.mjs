// THROWAWAY PROTOTYPE seam: evaluate source-owned projections outside the Next RSC graph.
import process from 'node:process';

import { buildToolExpansionGapReadModel } from '../../../../../../scripts/lib/build-tool-expansion-gap.mjs';

const projection = buildToolExpansionGapReadModel({
  baselineRevision: 'd3e6c4c44af0d0a6a8e243f4a4e61963bb838e87',
  reproducerSourceRevision: 'b6390254430d6baf49fa79df16b04eed64230d7b',
}).toProjection();

process.stdout.write(JSON.stringify(projection));
