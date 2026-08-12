#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

import { promoteToolVerificationRun } from './lib/promote-tool-verification-evidence.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const runIndex = process.argv.indexOf('--run');
const runId = process.argv[runIndex + 1];

if (!runId) {
  process.stderr.write(
    'Usage: node scripts/promote-tool-verification-evidence.mjs --run <run-id>\n',
  );
  process.exitCode = 1;
} else {
  try {
    const result = promoteToolVerificationRun({ repositoryRoot, runId });
    process.stdout.write(
      `retained ${result.runId} (${result.journeyResults} journey results)\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
