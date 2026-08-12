#!/usr/bin/env node

import {
  analyzeWorkflowOwnership,
  formatViolations,
  readTrackedSources,
} from './workflow-ownership.mjs';

const referenceIndex = process.argv.indexOf('--ref');
const ref =
  referenceIndex === -1 ? undefined : process.argv[referenceIndex + 1];
if (referenceIndex !== -1 && !ref) {
  throw new TypeError('--ref requires a Git revision');
}

const result = analyzeWorkflowOwnership(readTrackedSources(process.cwd(), ref));
const json = process.argv.includes('--json');
if (json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
const messages = formatViolations(result);
if (messages.length > 0) {
  process.stderr.write(`${messages.join('\n')}\n`);
  process.exitCode = 1;
} else if (!json) {
  process.stdout.write(
    `workflow-ownership-ok: ${result.acceptedInterface}; shared lifecycle owner ${result.canonicalLifecycleOwner}\n`,
  );
}
