#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';
import { summarizeToolAcceptance } from './lib/tool-acceptance-classification.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const supportedNodeMajor = 22;
const sourceRevisionFlagIndex = process.argv.indexOf('--source-revision');
const sourceRevision = process.argv[sourceRevisionFlagIndex + 1];

if (Number(process.versions.node.split('.')[0]) !== supportedNodeMajor) {
  throw new Error(
    `This audit reproducer requires Node ${supportedNodeMajor}; received ${process.versions.node}.`,
  );
}

if (!/^[0-9a-f]{40}$/.test(sourceRevision ?? '')) {
  throw new Error('Pass --source-revision with a full 40-character commit.');
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

runGit(['cat-file', '-e', `${sourceRevision}^{commit}`]);

const sourceTestFiles = runGit(['ls-tree', '-r', '--name-only', sourceRevision])
  .split('\n')
  .filter((file) => /\.test\.(?:mjs|ts|tsx)$/.test(file))
  .sort();
const currentTestFiles = runGit(['ls-files'])
  .split('\n')
  .filter((file) => /\.test\.(?:mjs|ts|tsx)$/.test(file))
  .sort();

if (JSON.stringify(currentTestFiles) !== JSON.stringify(sourceTestFiles)) {
  throw new Error(
    `Tracked test membership differs from audited revision ${sourceRevision}.`,
  );
}

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
      if (fs.existsSync(path.join(repositoryRoot, importedPath))) {
        pending.push(importedPath);
      }
    }
  }
  return Object.freeze([...inputs].sort());
}

// Pin the executable reproducer's complete local module graph as well as the
// product inputs. Otherwise a working-tree-only helper change could produce a
// payload that falsely names `sourceRevision` as its complete source.
const auditReproducerInputs = collectLocalModuleInputs(
  'scripts/audit-tool-coverage.mjs',
);
const auditedInputPaths = [
  ...auditReproducerInputs,
  'apps/tools',
  'packages/app-core',
  'packages/tool-telemetry',
  ...sourceTestFiles.filter(
    (file) =>
      !file.startsWith('apps/tools/') &&
      !file.startsWith('packages/app-core/') &&
      !file.startsWith('packages/tool-telemetry/'),
  ),
];
const sourceDiff = spawnSync(
  'git',
  ['diff', '--quiet', sourceRevision, '--', ...auditedInputPaths],
  { cwd: repositoryRoot },
);
if (sourceDiff.status !== 0) {
  throw new Error(
    `Audited inputs differ from source revision ${sourceRevision}; check out matching inputs before reproducing.`,
  );
}

const [
  { operationalToolCatalog: catalog },
  { executionProvenance },
  { selectToolRenderer },
  { getToolProcessorAvailability },
  { getGenericToolContract },
  { getTableOperationPolicy },
] = await Promise.all([
  import('../packages/app-core/src/lib/tool-catalog-adapter.mjs'),
  import('../apps/tools/lib/tool-execution-provenance.ts'),
  import('../apps/tools/lib/tool-renderer.ts'),
  import('../apps/tools/lib/tool-processor-registry.ts'),
  import('../apps/tools/lib/generic-tool-workflow.ts'),
  import('../apps/tools/lib/table-operation-policy.ts'),
]);

const fixtureRoot = path.join(repositoryRoot, 'apps/tools/benchmarks');
const fixtureMatrix = JSON.parse(
  fs.readFileSync(path.join(fixtureRoot, 'fixture-matrix.json'), 'utf8'),
);
const formatFixtures = new Map(
  fixtureMatrix.formats.map((entry) => [entry.format, entry]),
);
const toolFixtureIds = new Set(Object.keys(fixtureMatrix.toolFixtures ?? {}));
const dedicatedInstrumentedToolIds = new Set([
  'batch-compress-png',
  'character-counter',
  'csv-combiner',
]);
const noExplicitFailureToolIds = new Set([
  'character-counter',
  'html-to-markdown',
]);

function trackedTestFiles() {
  return currentTestFiles;
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function groupedToolIds(rows, selectKey) {
  const groups = new Map();
  for (const row of rows) {
    const key = selectKey(row);
    const ids = groups.get(key) ?? [];
    ids.push(row.id);
    groups.set(key, ids);
  }
  return Object.fromEntries(
    [...groups].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function coverage(rows, isCovered) {
  const coveredToolIds = rows.filter(isCovered).map((row) => row.id);
  const gapToolIds = rows.filter((row) => !isCovered(row)).map((row) => row.id);
  return {
    covered: coveredToolIds.length,
    gap: gapToolIds.length,
    gapToolIds,
  };
}

const tests = trackedTestFiles();
const testSources = new Map(
  tests.map((file) => [
    file,
    fs.readFileSync(path.join(repositoryRoot, file), 'utf8'),
  ]),
);

const tools = [...catalog.activeTools]
  .sort((left, right) => left.id.localeCompare(right.id))
  .map((tool) => {
    const renderer = selectToolRenderer(tool);
    const provenance = executionProvenance.getByToolId(tool.id);
    const processorAvailability = getToolProcessorAvailability(tool.id);
    const fixtureEntry = tool.from ? formatFixtures.get(tool.from) : null;
    const formatFixtureAvailable = Boolean(
      fixtureEntry?.status === 'ready' &&
        fixtureEntry.fixture &&
        fs.existsSync(path.join(fixtureRoot, fixtureEntry.fixture)),
    );
    const fixtureAvailable =
      toolFixtureIds.has(tool.id) || formatFixtureAvailable;
    const startedAndSucceededInstrumented =
      renderer === 'generic' ||
      renderer === 'downloader' ||
      dedicatedInstrumentedToolIds.has(tool.id);
    const failedInstrumented =
      startedAndSucceededInstrumented && !noExplicitFailureToolIds.has(tool.id);
    const browserFunctionalFixtureMapping =
      dedicatedInstrumentedToolIds.has(tool.id) ||
      (renderer === 'generic' && fixtureAvailable);
    const literalPattern = new RegExp(
      `["'\x60]${escapePattern(tool.id)}["'\x60]`,
    );
    const deterministicTestLiteralFiles = tests.filter((file) =>
      literalPattern.test(testSources.get(file)),
    );

    return {
      id: tool.id,
      operation: tool.operation,
      renderer,
      availabilityKind: processorAvailability.kind,
      genericContractState: getGenericToolContract(tool.id).state,
      tablePolicyKind: getTableOperationPolicy(tool.id).kind,
      executionProfiles:
        provenance.kind === 'mapped'
          ? [...provenance.executionProfiles]
          : ['unknown'],
      fixtureAvailable,
      startedAndSucceededInstrumented,
      failedInstrumented,
      browserFunctionalFixtureMapping,
      deterministicTestLiteralFiles,
    };
  });

const acceptanceClassification = summarizeToolAcceptance(tools);

const activeToolIds = tools.map((tool) => tool.id);
const allActiveGap = {
  covered: 0,
  gap: activeToolIds.length,
  gapToolIds: activeToolIds,
};

const payload = {
  schemaVersion: 3,
  auditDate: '2026-08-11',
  auditedSourceRevision: sourceRevision,
  sources: {
    catalog: 'packages/app-core/src/lib/tool-catalog-adapter.mjs',
    renderer: 'apps/tools/lib/tool-renderer.ts',
    executionProvenance: 'apps/tools/lib/tool-execution-provenance.ts',
    fixtures: 'apps/tools/benchmarks/fixture-matrix.json',
    telemetryClient: 'packages/tool-telemetry/src/client.ts',
    telemetryEndpoint: 'apps/tools/app/api/telemetry/route.ts',
    telemetryServer: 'packages/tool-telemetry/src/server.ts',
    d1Binding: 'apps/tools/lib/cloudflare-d1.ts',
    d1Queries: 'packages/tool-telemetry/src/d1.ts',
    d1Migration: 'apps/tools/migrations/0001_tool_telemetry.sql',
    dashboard: 'apps/tools/app/internal/tools/page.tsx',
    localCommands: 'apps/tools/package.json',
    smokeAndBenchmark: 'scripts/run-browser-check.mjs',
    deployedCanary: 'apps/tools/scripts/canary-cloudflare-deployed.mjs',
    retainedEvidence: 'scripts/lib/run-evidence.mjs -> .artifacts/runs',
    reproducer: 'scripts/audit-tool-coverage.mjs',
    telemetryEmitters: [
      'apps/tools/components/BatchHeroConverter.tsx',
      'apps/tools/components/CharacterCounter.tsx',
      'apps/tools/components/Converter.tsx',
      'apps/tools/components/CsvCombiner.tsx',
      'apps/tools/components/HeroConverter.tsx',
      'apps/tools/components/HtmlToMarkdownConverter.tsx',
      'apps/tools/components/JsonToCsv.tsx',
      'apps/tools/components/LanderHeroTwoColumn.tsx',
      'apps/tools/components/TranscribeTool.tsx',
      'apps/tools/components/VideoDownloaderTool.tsx',
    ],
  },
  portfolio: {
    activeToolCount: tools.length,
    activeToolIdsSha256: `sha256:${crypto
      .createHash('sha256')
      .update(JSON.stringify(activeToolIds))
      .digest('hex')}`,
    groupedToolIds: {
      byOperation: groupedToolIds(tools, (tool) => tool.operation),
      byRenderer: groupedToolIds(tools, (tool) => tool.renderer),
      byExecutionProfileSet: groupedToolIds(tools, (tool) =>
        tool.executionProfiles.join('+'),
      ),
    },
  },
  acceptanceClassification: {
    definition:
      'Every active Tool id appears exactly once: supported has a registered shared-workflow adapter; unsupported has an explicit generic or table fail-closed policy; unwired has known provenance without either; unknown lacks maintained provenance.',
    counts: acceptanceClassification.counts,
    toolIds: acceptanceClassification.toolIds,
  },
  coverage: {
    explicitExecutionProvenance: coverage(
      tools,
      (tool) => !tool.executionProfiles.includes('unknown'),
    ),
    fixtureAvailability: coverage(tools, (tool) => tool.fixtureAvailable),
    startedAndSucceededInstrumentation: coverage(
      tools,
      (tool) => tool.startedAndSucceededInstrumented,
    ),
    failedInstrumentation: coverage(tools, (tool) => tool.failedInstrumented),
    browserFunctionalFixtureMapping: coverage(
      tools,
      (tool) => tool.browserFunctionalFixtureMapping,
    ),
    deterministicTestLiteralReference: coverage(
      tools,
      (tool) => tool.deterministicTestLiteralFiles.length > 0,
    ),
    portableRetainedPerToolVerificationEvidence: allActiveGap,
    authorizedRuntimeObservationCoverage: {
      ...allActiveGap,
      classification: 'unknown',
      reason:
        'No runtime environment was authorized or queried during this audit.',
    },
  },
  definitions: {
    fixtureAvailability:
      'A Tool-specific fixture exists, or the Tool from value joins to a ready fixture whose file exists.',
    startedAndSucceededInstrumentation:
      'The active route resolves to a component that calls beginToolRun and finishSuccess.',
    failedInstrumentation:
      'The active route also has an explicit finishFailure call; character-counter and html-to-markdown do not.',
    browserFunctionalFixtureMapping:
      'The smoke runner has a Tool-specific functional path, or the generic renderer has an available input fixture. This is runnable potential, not passing evidence.',
    deterministicTestLiteralReference:
      'At least one committed test source contains the exact Tool id as a quoted literal. This is an inventory aid, not proof of functional behavior or a retained result.',
    portableRetainedPerToolVerificationEvidence:
      'A fresh clone contains no per-Tool result joined to an invariant, revision, environment, scope, and time.',
    authorizedRuntimeObservationCoverage:
      'Unknown for every Tool because no runtime environment query was authorized. Gap means evidence unavailable for console ingestion, not success or failure.',
  },
};

process.stdout.write(await format(JSON.stringify(payload), { parser: 'json' }));
