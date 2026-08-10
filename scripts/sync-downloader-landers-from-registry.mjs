#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCatalogSyncMode } from './lib/catalog-sync-mode.mjs';
import { planDownloaderRegistrySync } from './lib/downloader-registry-sync.mjs';

const repositoryRoot = process.cwd();
const registryApiPath =
  'repos/serpcompany/downloader-source-registry/contents/data/source-repo-data-json-config.json';
const inputAuthority =
  'serpcompany/downloader-source-registry data/source-repo-data-json-config.json';

function readRegistryAuthority() {
  return JSON.parse(
    execFileSync(
      'gh',
      ['api', '-H', 'Accept: application/vnd.github.raw', registryApiPath],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    ),
  );
}

export async function synchronizeDownloaderRegistry({
  registry = readRegistryAuthority(),
  write = false,
  root = repositoryRoot,
  verifyUrl,
} = {}) {
  const ownedToolsPath = path.join(
    root,
    'packages/app-core/src/data/tools.json',
  );
  const ownedPlannerPath = path.join(
    root,
    'docs/evidence/tool-planning/tools_planner.csv',
  );
  const [toolsSource, plannerSource] = await Promise.all([
    fs.readFile(ownedToolsPath, 'utf8'),
    fs.readFile(ownedPlannerPath, 'utf8'),
  ]);
  const plan = await planDownloaderRegistrySync({
    toolsSource,
    plannerSource,
    registry,
    ...(verifyUrl === undefined ? {} : { verifyUrl }),
  });

  console.log(`Input authority: ${inputAuthority}`);
  console.log(
    'Owned outputs: packages/app-core/src/data/tools.json, docs/evidence/tool-planning/tools_planner.csv',
  );
  console.log(
    plan.newTools.length
      ? `Proposed diff: add Tool ids ${plan.newTools.map((tool) => tool.id).join(', ')}; add ${plan.plannerRows.length} planner rows`
      : 'Proposed diff: no changes',
  );
  console.log(
    'Outbound links use exact registry URLs that passed verification.',
  );

  if (write && plan.newTools.length) {
    await fs.writeFile(ownedToolsPath, plan.nextToolsSource);
    await fs.writeFile(ownedPlannerPath, plan.nextPlannerSource);
  }
  console.log(
    write ? 'Write mode complete.' : 'Check mode: repository unchanged.',
  );
  return plan;
}

async function main() {
  const options = parseCatalogSyncMode(process.argv.slice(2));
  await synchronizeDownloaderRegistry(options);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : 'Downloader registry sync failed',
    );
    process.exitCode = 1;
  });
}
