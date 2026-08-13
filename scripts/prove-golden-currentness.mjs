import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { proveGoldenCurrentnessPreview } from './lib/golden-currentness-preview.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2).filter((value) => value !== '--');
const value = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? '' : (args[index + 1] ?? '');
};

const result = await proveGoldenCurrentnessPreview({
  repositoryRoot: path.resolve(repositoryRoot),
  revision: value('--revision'),
  baseUrl: value('--base-url'),
  environment: {
    TOOL_FACTORY_CF_AUTHORIZATION:
      process.env.TOOL_FACTORY_CF_AUTHORIZATION ?? '',
  },
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
