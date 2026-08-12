#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildToolExpansionGapReadModel } from './lib/build-tool-expansion-gap.mjs';
import { renderToolExpansionGapReport } from './lib/tool-expansion-gap-report.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const supportedNodeMajor = 22;
const acceptedPortfolioBaselineRevision =
  'd3e6c4c44af0d0a6a8e243f4a4e61963bb838e87';
const consumedProductInputs = Object.freeze([
  'apps/tools',
  'packages/app-core',
]);
const auditEntryPath = 'scripts/audit-tool-expansion-gap.mjs';

function collectLocalModuleInputs(entryPath) {
  const inputs = new Set();
  const pending = [entryPath];
  const importPattern = /(?:from\s*|import\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/g;
  while (pending.length > 0) {
    const relativePath = pending.pop();
    if (!relativePath || inputs.has(relativePath)) continue;
    inputs.add(relativePath);
    const source = fs.readFileSync(
      path.join(repositoryRoot, relativePath),
      'utf8',
    );
    for (const match of source.matchAll(importPattern)) {
      const importedPath = path.posix.normalize(
        path.posix.join(path.posix.dirname(relativePath), match[1]),
      );
      if (fs.existsSync(path.join(repositoryRoot, importedPath)))
        pending.push(importedPath);
    }
  }
  return Object.freeze([...inputs].sort());
}

function parseArguments(arguments_) {
  const args = arguments_[0] === '--' ? arguments_.slice(1) : arguments_;
  const parsed = { sourceRevision: undefined, outputFormat: 'json' };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value) throw new Error(`${flag ?? 'argument'} requires a value.`);
    if (seen.has(flag))
      throw new Error(`Unsupported or repeated argument: ${flag}`);
    seen.add(flag);
    if (flag === '--source-revision') {
      parsed.sourceRevision = value;
    } else if (flag === '--format') {
      parsed.outputFormat = value;
    } else {
      throw new Error(`Unsupported or repeated argument: ${flag}`);
    }
  }
  return parsed;
}

function runGit(arguments_) {
  const result = spawnSync('git', arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${arguments_.join(' ')} failed: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return result.stdout;
}

if (Number(process.versions.node.split('.')[0]) !== supportedNodeMajor) {
  throw new Error(
    `This expansion-gap audit requires Node ${supportedNodeMajor}; received ${process.versions.node}.`,
  );
}

const { sourceRevision, outputFormat } = parseArguments(process.argv.slice(2));
if (!/^[0-9a-f]{40}$/.test(sourceRevision ?? '')) {
  throw new Error('Pass --source-revision with a full 40-character commit.');
}
if (outputFormat !== 'json' && outputFormat !== 'report') {
  throw new Error('--format must be json or report.');
}

runGit(['cat-file', '-e', `${sourceRevision}^{commit}`]);
const auditedInputs = Object.freeze([
  ...collectLocalModuleInputs(auditEntryPath),
  ...consumedProductInputs,
]);
const productDiff = spawnSync(
  'git',
  ['diff', '--quiet', sourceRevision, '--', ...auditedInputs],
  { cwd: repositoryRoot },
);
if (productDiff.status !== 0) {
  throw new Error(
    `Consumed projection, Catalog, or Tool execution inputs differ from source revision ${sourceRevision}.`,
  );
}

const projection = buildToolExpansionGapReadModel({
  baselineRevision: acceptedPortfolioBaselineRevision,
  reproducerSourceRevision: sourceRevision,
}).toProjection();
process.stdout.write(
  outputFormat === 'json'
    ? `${JSON.stringify(projection, null, 2)}\n`
    : renderToolExpansionGapReport(projection),
);
