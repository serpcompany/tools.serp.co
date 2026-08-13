import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { recordRunEvidence } from './lib/run-evidence.mjs';
import {
  assertGoldenBrowserManifest,
  summarizeGoldenPilotProjection,
} from './lib/golden-pilot-contract.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const FIXED_TOOL_IDS = Object.freeze([
  'audio-to-text',
  'audio-to-transcript',
  'batch-compress-png',
  'bmp-to-png',
  'compress-pdf',
  'csv-to-json',
  'pdf-reader',
  'png-to-webp',
  'video-downloader',
]);
const FIXED_MEMBERSHIP_HASH =
  'sha256:cf077705f900e695b0310fbd090dbd366fa3c01219f93b2076f849b3396ba6ba';
const ADDITION_IMPLEMENTATION_STARTED_AT = '2026-08-13T01:10:26.000Z';
const HELP = `Usage: pnpm proof:golden-pilot -- --environment <local|preview> --base-url <origin> --revision <full-sha>\n\nRuns the fixed Golden Journey portfolio, the MP4 to WebM same-family addition, the Tool Factory decision view, and the currentness proof from one clean checkout.\n`;

function parseArguments(argv) {
  const values = { environment: '', baseUrl: '', revision: '', help: false };
  const tokens = argv.filter((value) => value !== '--');
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--help' || token === '-h') values.help = true;
    else if (token === '--environment')
      values.environment = tokens[++index] ?? '';
    else if (token === '--base-url') values.baseUrl = tokens[++index] ?? '';
    else if (token === '--revision') values.revision = tokens[++index] ?? '';
    else throw new Error(`Unknown Golden pilot option: ${token}`);
  }
  if (values.help) return values;
  if (!new Set(['local', 'preview']).has(values.environment)) {
    throw new Error('--environment must be local or preview');
  }
  if (!/^[a-f0-9]{40}$/.test(values.revision)) {
    throw new Error('--revision requires a full 40-character SHA');
  }
  const url = new URL(values.baseUrl);
  const loopback = new Set(['localhost', '127.0.0.1', '::1']).has(url.hostname);
  if (
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (values.environment === 'local' &&
      (!loopback || url.protocol !== 'http:')) ||
    (values.environment === 'preview' &&
      (loopback || url.protocol !== 'https:'))
  ) {
    throw new Error('--base-url must be the exact sanitized target origin');
  }
  return values;
}

function run(command, arguments_, environment = {}) {
  return execFileSync(command, arguments_, {
    cwd: repositoryRoot,
    env: { ...process.env, ...environment },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function artifactId(output) {
  const match = /Structured artifact: ([a-zA-Z0-9._-]+)/.exec(output);
  if (!match)
    throw new Error('A Golden pilot component omitted its artifact id.');
  return match[1];
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderReport(report) {
  const rows = report.journeys
    .map(
      (journey) =>
        `<tr><td>${escapeHtml(journey.journeyId)}</td><td>${escapeHtml(journey.observedResult)}</td><td>${escapeHtml(journey.evidenceResult)}</td><td>${escapeHtml(journey.whereItRuns)}</td><td>${escapeHtml(journey.checks.join(', ') || 'No checks retained')}</td><td>${escapeHtml(journey.freshness)}</td><td>${escapeHtml(journey.remainingGap)}</td><td><a href="${escapeHtml(journey.tryUrl)}">Try it</a></td></tr>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Golden Journey pilot</title><style>body{font:16px system-ui;max-width:1500px;margin:40px auto;padding:0 20px;color:#172033}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd3dd;padding:10px;text-align:left;vertical-align:top}.callout{padding:16px;border:1px solid #e0a800;background:#fff8db;border-radius:8px}code{font-size:12px}</style></head><body><h1>Golden Journey pilot</h1><p class="callout"><strong>Execution ${escapeHtml(report.package.executionStatus)}.</strong> Evidence decision: <strong>${escapeHtml(report.package.verificationDecision)}</strong> (${escapeHtml(report.package.acceptanceStatus)}). A completed proof command means the package was generated; it does not by itself mean the pilot was accepted. The maintainer records <strong>continue / repair / reconsider</strong>.</p><p>This is a fixed 10-journey decision sample. It does not claim all Tools work. The observed browser outcome and retained evidence state are separate below.</p><p>Revision <code>${escapeHtml(report.revision)}</code><br>Membership <code>${escapeHtml(report.membershipHash)}</code></p><h2>Observed journeys</h2><table><thead><tr><th>Journey</th><th>Observed result</th><th>Evidence state</th><th>Where it runs</th><th>Checks retained</th><th>Freshness</th><th>Remaining gap</th><th>Open Tool</th></tr></thead><tbody>${rows}</tbody></table><h2>Evidence currentness</h2><pre>${escapeHtml(JSON.stringify(report.currentness, null, 2))}</pre><h2>Same-family scaling check</h2><p><strong>mp4-to-webm</strong> reused the WebM processor contract, fixture, semantic validator, delivery, cancellation, and telemetry lifecycle. No lifecycle implementation was added.</p><p>Measured elapsed implementation and verification window: ${escapeHtml(report.sameFamilyAddition.elapsedMinutes)} minutes.</p><h2>Evidence files</h2><ul><li><a href="screenshots/tool-factory-golden-pilot.png">Tool Factory Golden Pilot screenshot</a></li><li><a href="screenshots/png-to-webp-success.png">Successful conversion screenshot</a></li><li><a href="screenshots/audio-to-text-youtube-unsupported.png">Honest unsupported screenshot</a></li><li><a href="screenshots/compress-pdf-unavailable.png">Server-unavailable screenshot</a></li><li><a href="outputs/png-to-webp.webp" download>PNG to WebP sample output</a></li><li><a href="outputs/mp4-to-webm.webm" download>MP4 to WebM sample output</a></li></ul></body></html>`;
}

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  process.stdout.write(HELP);
  process.exit(0);
}
const startedAt = new Date();
const head = run('git', ['rev-parse', 'HEAD']).trim();
const dirty = run('git', [
  'status',
  '--porcelain',
  '--untracked-files=all',
]).trim();
if (head !== options.revision || dirty) {
  throw new Error(
    'Golden pilot proof requires a clean checkout at --revision.',
  );
}

const scratch = mkdtempSync(path.join(os.tmpdir(), 'tools-serp-golden-pilot.'));
const screenshotBase = path.join(scratch, 'tool-factory.png');
const captureRoot = path.join(scratch, 'captures');
mkdirSync(captureRoot, { recursive: true });
const commonEnvironment = {
  GOLDEN_SCREENSHOT_DIR: captureRoot,
  GOLDEN_OUTPUT_DIR: captureRoot,
};
const browserArguments = [
  'scripts/run-browser-check.mjs',
  '--mode',
  'smoke',
  '--environment',
  options.environment,
  '--revision',
  options.revision,
  '--base-url',
  options.baseUrl,
];
const fixedOutput = run(process.execPath, browserArguments, {
  ...commonEnvironment,
  TOOLS_ONLY: FIXED_TOOL_IDS.join(','),
});
const additionOutput = run(process.execPath, browserArguments, {
  ...commonEnvironment,
  TOOLS_ONLY: 'mp4-to-webm',
});
const factoryOutput = run(process.execPath, [
  'apps/tools/scripts/check-tool-factory-table.mjs',
  '--environment',
  options.environment === 'preview' ? 'DEV/STAGING' : 'LOCAL',
  '--base-url',
  options.baseUrl,
  '--revision',
  options.revision,
  '--screenshot',
  screenshotBase,
]);
const currentness = JSON.parse(
  run(process.execPath, [
    '--experimental-strip-types',
    'apps/tools/lib/golden-pilot-currentness-proof.ts',
  ]),
);
const componentArtifacts = {
  journeys: artifactId(fixedOutput),
  sameFamilyAddition: artifactId(additionOutput),
  toolFactory: artifactId(factoryOutput),
};
const journeyManifest = JSON.parse(
  readFileSync(
    path.join(
      repositoryRoot,
      '.artifacts/runs',
      componentArtifacts.journeys,
      'manifest.json',
    ),
    'utf8',
  ),
);
assertGoldenBrowserManifest(journeyManifest);
const sourceView = JSON.parse(
  run(process.execPath, [
    '--experimental-strip-types',
    'apps/tools/lib/golden-pilot-source-view.ts',
  ]),
);
const projectedByJourney = new Map(
  sourceView.rows.map((row) => [row.journeyId, row]),
);
const packageSummary = summarizeGoldenPilotProjection(sourceView.rows);
const routeByTool = Object.freeze({
  'audio-to-text': '/audio-to-text/',
  'audio-to-transcript': '/audio-to-transcript/',
  'batch-compress-png': '/batch-compress-png/',
  'bmp-to-png': '/bmp-to-png/',
  'compress-pdf': '/compress-pdf/',
  'csv-to-json': '/csv-to-json/',
  'pdf-reader': '/pdf-reader/',
  'png-to-webp': '/png-to-webp/',
  'video-downloader': '/video-downloader/',
});
const journeys = journeyManifest.scope.tools.flatMap((tool) =>
  tool.journeys.map((journey) => ({
    journeyId: journey.journeyId,
    outcome: journey.outcome,
    checks: journey.checks,
    observedResult: journey.outcome,
    evidenceState: projectedByJourney.get(journey.journeyId)?.evidenceState,
    evidenceResult: projectedByJourney.get(journey.journeyId)?.resultLabel,
    whereItRuns: projectedByJourney.get(journey.journeyId)?.whereItRuns,
    freshness: projectedByJourney.get(journey.journeyId)?.freshness,
    remainingGap: projectedByJourney.get(journey.journeyId)?.remainingGap,
    tryUrl: new URL(routeByTool[tool.toolId], options.baseUrl).href,
  })),
);
const completedAt = new Date();
const elapsedMinutes = Math.max(
  1,
  Math.round(
    (completedAt.valueOf() -
      new Date(ADDITION_IMPLEMENTATION_STARTED_AT).valueOf()) /
      60_000,
  ),
);
const evidence = recordRunEvidence({
  repositoryRoot,
  command: 'proof:golden-pilot',
  commandVersion: '1',
  revision: options.revision,
  environment: options.environment === 'preview' ? 'pull-request' : 'local',
  scope: 'golden-journey-pilot',
  status: 'success',
  ...(options.environment === 'local'
    ? { retentionClass: 'retained-debug' }
    : {}),
  linkedWork: ['#73', '#124'],
  startedAt: startedAt.toISOString(),
  completedAt: completedAt.toISOString(),
  summary: {
    status: 'success',
    checksPassed: journeys.length + 6,
    checksFailed: 0,
    items: journeys.length,
    durationMs: completedAt.valueOf() - startedAt.valueOf(),
  },
});
const artifactRoot = path.join(
  repositoryRoot,
  '.artifacts/runs',
  evidence.runId,
);
mkdirSync(path.join(artifactRoot, 'screenshots'), { recursive: true });
mkdirSync(path.join(artifactRoot, 'outputs'), { recursive: true });
for (const [sourceName, targetName] of [
  [
    path.join(scratch, 'tool-factory-golden-pilot.png'),
    'screenshots/tool-factory-golden-pilot.png',
  ],
  [
    path.join(captureRoot, 'png-to-webp-success.png'),
    'screenshots/png-to-webp-success.png',
  ],
  [
    path.join(captureRoot, 'audio-to-text-youtube-unsupported.png'),
    'screenshots/audio-to-text-youtube-unsupported.png',
  ],
  [
    path.join(captureRoot, 'compress-pdf-unavailable.png'),
    'screenshots/compress-pdf-unavailable.png',
  ],
  [path.join(captureRoot, 'png-to-webp.webp'), 'outputs/png-to-webp.webp'],
  [path.join(captureRoot, 'mp4-to-webm.webm'), 'outputs/mp4-to-webm.webm'],
]) {
  copyFileSync(sourceName, path.join(artifactRoot, targetName));
}
const report = {
  title: 'Golden Journey pilot',
  revision: options.revision,
  environment: options.environment,
  membershipHash: FIXED_MEMBERSHIP_HASH,
  package: packageSummary,
  componentArtifacts,
  journeys,
  currentness,
  sameFamilyAddition: {
    toolId: 'mp4-to-webm',
    elapsedMinutes,
    repeatedSteps: [
      'declare exact processor contract',
      'bind a real fixture',
      'prove independent output semantics',
      'prove spoof and wrong-format rejection',
      'run the real browser runtime',
      'regenerate portfolio evidence',
    ],
  },
};
writeFileSync(
  path.join(artifactRoot, 'report.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  { mode: 0o600, flag: 'wx' },
);
writeFileSync(path.join(artifactRoot, 'report.html'), renderReport(report), {
  mode: 0o600,
  flag: 'wx',
});
process.stdout.write(
  `Golden Journey pilot execution completed.\nEvidence decision: ${packageSummary.verificationDecision} (${packageSummary.acceptanceStatus}).\nReport: ${path.join(artifactRoot, 'report.html')}\nStructured artifact: ${evidence.runId}\n`,
);
