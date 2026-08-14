import { readFileSync } from 'node:fs';
import path from 'node:path';

import { proveIcoNegativePaths } from '../apps/tools/lib/ico-negative-path-probe.ts';

const fixtureDirectory = path.resolve(
  import.meta.dirname,
  '../apps/tools/benchmarks/fixtures',
);
const fixture = (name) =>
  new Uint8Array(readFileSync(path.join(fixtureDirectory, name)));

process.stdout.write(
  `${JSON.stringify(
    await proveIcoNegativePaths({
      validIco: fixture('sample.ico'),
      spoofedNonIco: fixture('sample.png'),
      wrongFormatOutput: fixture('sample.jpg'),
    }),
  )}\n`,
);
