import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  isTiffToPngToolId,
  TIFF_TO_PNG_TOOL_IDS,
} from '../apps/tools/lib/convert/tiff-family.mjs';

import { proveTiffNegativePaths } from '../apps/tools/lib/tiff-negative-path-probe.ts';

const toolId = process.argv[2];
if (!isTiffToPngToolId(toolId)) {
  throw new TypeError(`Expected ${TIFF_TO_PNG_TOOL_IDS.join(' or ')}.`);
}
const fixtureDirectory = path.resolve(
  import.meta.dirname,
  '../apps/tools/benchmarks/fixtures',
);
const fixture = (name) =>
  new Uint8Array(readFileSync(path.join(fixtureDirectory, name)));
const validFixture =
  toolId === 'tif-to-png'
    ? 'tiff/rgb-little-stripped-none.tiff'
    : 'tiff/rgb-big-tiled-lzw.tiff';

process.stdout.write(
  `${JSON.stringify(
    await proveTiffNegativePaths(toolId, {
      validTiff: fixture(validFixture),
      spoofedNonTiff: fixture('sample.png'),
      wrongFormatOutput: fixture('sample.jpg'),
    }),
  )}\n`,
);
