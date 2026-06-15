#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repo = process.cwd();
const capabilitiesPath = path.join(repo, 'data/downloader-capabilities.adult.json');
const toolsPath = path.join(repo, 'packages/app-core/src/data/tools.json');
const dryRun = process.argv.includes('--dry-run');

const capabilities = JSON.parse(fs.readFileSync(capabilitiesPath, 'utf8'));
const tools = JSON.parse(fs.readFileSync(toolsPath, 'utf8'));
const byRoute = new Map(capabilities.map((capability) => [capability.route, capability]));

function labelForStatus(status) {
  switch (status) {
    case 'web_download_verified':
    case 'works_with_ytdlp':
      return 'Web downloader verified';
    case 'works_with_simple_html_json_extractor':
      return 'Support in progress';
    case 'extension_only':
    case 'needs_custom_extractor':
      return 'Browser extension recommended';
    case 'blocked_or_dead':
      return 'Do not publish without manual review';
    default:
      return 'Support in progress';
  }
}

const changes = [];
for (const tool of tools) {
  const route = tool.route || `/${tool.id}`;
  const capability = byRoute.get(route);
  if (!capability) continue;
  const label = labelForStatus(capability.status);
  const next = {
    capabilityStatus: capability.status,
    capabilityExtractor: capability.extractor,
    capabilityLabel: label,
    capabilityLastTestedAt: capability.last_tested_at,
  };
  changes.push({ id: tool.id, route, next });
  if (!dryRun) Object.assign(tool, next);
}

for (const change of changes) {
  console.log(`${dryRun ? 'would update' : 'updated'} ${change.route}: ${change.next.capabilityLabel} (${change.next.capabilityExtractor || change.next.capabilityStatus})`);
}
console.log(`${dryRun ? 'Dry run' : 'Applied'} ${changes.length} capability updates.`);

if (!dryRun) {
  fs.writeFileSync(toolsPath, `${JSON.stringify(tools, null, 2)}\n`);
}
