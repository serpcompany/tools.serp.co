#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright';

import { recordRunEvidence } from './lib/run-evidence.mjs';
import {
  describeDelivery,
  evaluateBrowserObservation,
  finalizeComparison,
  renderProofReport,
  validateComparison,
  validateProofRevisions,
} from './lib/tool-workflow-proof.mjs';
import {
  analyzeWorkflowOwnership,
  readTrackedSources,
} from './workflow-ownership.mjs';

const HISTORICAL_BASELINE = 'd4499e333450f5bc501e3842d37deb029717aef4';
const HELP = `Usage:
  pnpm proof:tool-workflow -- --baseline <full-commit-sha> --current <full-commit-sha>

Both arguments are required and must be distinct, full commit SHAs. The
documented historical baseline is ${HISTORICAL_BASELINE}; it is not silently
applied. Current must equal a clean HEAD. The command checks out disposable
local worktrees, runs the same semantic browser evaluator against both, and
writes ignored retained-debug evidence. It does not deploy anything.
`;

function parseArguments(arguments_) {
  if (arguments_[0] === '--') arguments_ = arguments_.slice(1);
  if (arguments_.includes('--help') || arguments_.includes('-h')) {
    return { help: true };
  }
  const allowed = new Set(['--baseline', '--current']);
  const options = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!allowed.has(name) || !value || value.startsWith('--')) {
      throw new TypeError(HELP);
    }
    options[name.slice(2)] = value;
  }
  if (!options.baseline || !options.current) {
    throw new TypeError(HELP);
  }
  return options;
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${arguments_.join(' ')} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}

function git(repositoryRoot, arguments_) {
  return run('git', arguments_, { cwd: repositoryRoot });
}

function assertClean(repositoryRoot) {
  const changes = git(repositoryRoot, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--',
    'apps/tools',
    'packages/app-core',
    'packages/tool-telemetry',
    'packages/ui',
    'scripts',
    'package.json',
    'pnpm-lock.yaml',
  ]);
  if (changes) {
    throw new Error(
      'Consumed current proof inputs must be clean; commit or remove changes in application, package, and harness inputs first.',
    );
  }
}

function isCommit(repositoryRoot, revision) {
  const result = spawnSync(
    'git',
    ['cat-file', '-e', `${revision}^{commit}`],
    { cwd: repositoryRoot, stdio: 'ignore' },
  );
  return result.status === 0;
}

function isAncestor(repositoryRoot, baseline, current) {
  return (
    spawnSync('git', ['merge-base', '--is-ancestor', baseline, current], {
      cwd: repositoryRoot,
      stdio: 'ignore',
    }).status === 0
  );
}

async function reservePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Could not reserve a local proof port');
  }
  const port = address.port;
  server.close();
  await once(server, 'close');
  return port;
}

async function waitForServer(origin, child, logs) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Local revision server exited early:\n${logs()}`);
    }
    try {
      const response = await fetch(origin, { redirect: 'manual' });
      if (response.status > 0) return;
    } catch {
      // The owned local server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${origin}:\n${logs()}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit').catch(() => {});
  }
}

async function withRevisionServer(repositoryRoot, revision, label, action) {
  const scratchRoot = mkdtempSync(
    path.join(tmpdir(), `tools-serp-proof-${label}-`),
  );
  const worktree = path.join(scratchRoot, 'revision');
  let added = false;
  let child;
  let output = '';
  try {
    git(repositoryRoot, ['worktree', 'add', '--detach', worktree, revision]);
    added = true;
    run(
      'pnpm',
      ['install', '--offline', '--frozen-lockfile', '--ignore-scripts'],
      { cwd: worktree, env: process.env },
    );
    const port = await reservePort();
    const origin = `http://127.0.0.1:${port}`;
    child = spawn(
      process.execPath,
      [
        path.join(worktree, 'apps/tools/node_modules/next/dist/bin/next'),
        'dev',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(port),
      ],
      {
        cwd: path.join(worktree, 'apps/tools'),
        detached: false,
        env: {
          ...process.env,
          NEXT_TELEMETRY_DISABLED: '1',
          TURBO_TELEMETRY_DISABLED: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const retain = (chunk) => {
      output = `${output}${chunk}`.slice(-16_384);
    };
    child.stdout.on('data', retain);
    child.stderr.on('data', retain);
    await waitForServer(origin, child, () => output);
    return await action({ origin, worktree });
  } finally {
    if (child) await stopServer(child);
    if (added) {
      const removal = spawnSync(
        'git',
        ['worktree', 'remove', '--force', worktree],
        { cwd: repositoryRoot, encoding: 'utf8' },
      );
      if (removal.status !== 0) {
        process.stderr.write(
          `warning: disposable worktree cleanup failed: ${removal.stderr}\n`,
        );
      }
    }
    const expectedPrefix = path.join(tmpdir(), `tools-serp-proof-${label}-`);
    if (scratchRoot.startsWith(expectedPrefix)) {
      rmSync(scratchRoot, { recursive: true, force: true });
    }
  }
}

async function addCaptureHook(page) {
  await page.addInitScript(() => {
    const originalCreate = URL.createObjectURL.bind(URL);
    const originalClick = HTMLAnchorElement.prototype.click;
    window.__toolWorkflowProofBlobs = [];
    URL.createObjectURL = (blob) => {
      const url = originalCreate(blob);
      const record = {
        url,
        mimeType: blob.type,
        size: blob.size,
        name: null,
        base64: null,
      };
      window.__toolWorkflowProofBlobs.push(record);
      void blob.arrayBuffer().then((buffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        }
        record.base64 = btoa(binary);
      });
      return url;
    };
    HTMLAnchorElement.prototype.click = function proofClick() {
      const record = window.__toolWorkflowProofBlobs.find(
        ({ url }) => url === this.href,
      );
      if (record) record.name = this.download || null;
      return originalClick.call(this);
    };
  });
}

async function observeScenario(browser, origin, scenario, fixtures) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/*', async (route) => {
    const target = new URL(route.request().url());
    if (
      (target.hostname === '127.0.0.1' || target.hostname === 'localhost') &&
      target.origin === origin
    ) {
      await route.continue();
      return;
    }
    await route.abort('blockedbyclient');
  });
  await addCaptureHook(page);
  const definition = {
    'wrong-target-format': {
      toolId: 'bmp-to-ktx2',
      route: '/bmp-to-ktx2',
      file: { name: 'sample.bmp', mimeType: 'image/bmp', buffer: fixtures.bmp },
    },
    'spoofed-input': {
      toolId: 'png-to-webp',
      route: '/png-to-webp',
      file: { name: 'spoof.png', mimeType: 'image/png', buffer: fixtures.jpeg },
    },
    'valid-control': {
      toolId: 'png-to-webp',
      route: '/png-to-webp',
      file: { name: 'sample.png', mimeType: 'image/png', buffer: fixtures.png },
    },
  }[scenario];
  try {
    await page.goto(`${origin}${definition.route}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    const input = page.locator('[data-testid="tool-file-input"]');
    await input.waitFor({ state: 'attached', timeout: 45_000 });
    await input.setInputFiles(definition.file);
    await page.waitForFunction(
      () => {
        const readyBlob = window.__toolWorkflowProofBlobs?.some(
          ({ base64, name }) =>
            typeof base64 === 'string' && typeof name === 'string',
        );
        const progress = document.querySelector('[data-testid="video-progress"]');
        const status = progress?.getAttribute('data-status');
        const text = progress?.textContent?.toLowerCase() ?? '';
        return (
          readyBlob ||
          status === 'error' ||
          text.includes('failed') ||
          text.includes('not supported')
        );
      },
      undefined,
      { timeout: 45_000 },
    );
    const captured = await page.evaluate(() =>
      window.__toolWorkflowProofBlobs
        ?.filter(
          ({ base64, name }) =>
            typeof base64 === 'string' && typeof name === 'string',
        )
        .at(-1),
    );
    const progress = await page
      .locator('[data-testid="video-progress"]')
      .first()
      .textContent()
      .catch(() => null);
    const delivery = captured
      ? describeDelivery({
          name: captured.name,
          mimeType: captured.mimeType,
          bytes: Buffer.from(captured.base64, 'base64'),
        })
      : null;
    return evaluateBrowserObservation({
      scenario,
      toolId: definition.toolId,
      terminal: delivery ? 'delivered' : 'failed',
      delivery,
      visibleMessage: progress?.trim() ?? null,
      pageErrors,
    });
  } catch (error) {
    return {
      scenario,
      toolId: definition.toolId,
      terminal: 'blocked',
      delivery: null,
      visibleMessage: null,
      pageErrors,
      verdict: 'blocked',
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await page.close();
  }
}

async function evaluateRevision(repositoryRoot, revision, label, fixtures) {
  return withRevisionServer(
    repositoryRoot,
    revision,
    label,
    async ({ origin }) => {
      const browser = await chromium.launch({ headless: true });
      try {
        const results = [];
        for (const scenario of [
          'wrong-target-format',
          'spoofed-input',
          'valid-control',
        ]) {
          results.push(
            await observeScenario(browser, origin, scenario, fixtures),
          );
        }
        return results;
      } finally {
        await browser.close();
      }
    },
  );
}

function ownershipAt(repositoryRoot, revision) {
  const result = analyzeWorkflowOwnership(
    readTrackedSources(repositoryRoot, revision),
  );
  return {
    reachableImplementationCount: result.reachableImplementationCount,
    duplicateImplementationCount: result.duplicateImplementationCount,
    canonicalLifecycleOwner: result.canonicalLifecycleOwner,
    lifecycleInventory: result.lifecycleInventory,
    familySeamEvidence: result.familySeamEvidence,
    violations: result.violations,
  };
}

function currentPortfolio(repositoryRoot, current) {
  const payload = JSON.parse(
    run(
      'pnpm',
      [
        '--silent',
        'audit:tool-coverage',
        '--',
        '--source-revision',
        current,
      ],
      { cwd: repositoryRoot, env: process.env },
    ),
  );
  const counts = payload.acceptanceClassification.counts;
  return {
    active: payload.portfolio.activeToolCount,
    supported: counts.supported,
    unsupported: counts.unsupported,
    unwired: counts.unwired,
    unknown: counts.unknown,
  };
}

function writeArtifact({
  repositoryRoot,
  comparison,
  current,
  startedAt,
  completedAt,
}) {
  validateComparison(comparison);
  const checks =
    comparison.runtime.baseline.length +
    comparison.runtime.current.length +
    Object.keys(comparison.runtime.currentSeamProbes).length +
    2;
  const evidence = recordRunEvidence({
    repositoryRoot,
    command: 'proof:tool-workflow',
    commandVersion: '1',
    revision: current,
    environment: 'local',
    scope: 'before-after',
    status: 'success',
    retentionClass: 'retained-debug',
    linkedWork: ['#74', '#84'],
    startedAt,
    completedAt,
    summary: { status: 'success', checksPassed: checks, checksFailed: 0 },
  });
  const artifactRoot = path.join(
    repositoryRoot,
    '.artifacts',
    'runs',
    evidence.runId,
  );
  writeFileSync(
    path.join(artifactRoot, 'comparison.json'),
    `${JSON.stringify(comparison, null, 2)}\n`,
    { mode: 0o600, flag: 'wx' },
  );
  writeFileSync(
    path.join(artifactRoot, 'report.html'),
    renderProofReport(comparison),
    { mode: 0o600, flag: 'wx' },
  );
  return artifactRoot;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  if (Number(process.versions.node.split('.')[0]) !== 22) {
    throw new Error('proof:tool-workflow requires the supported Node 22 runtime');
  }
  const repositoryRoot = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  if (path.resolve(repositoryRoot) !== path.resolve(process.cwd())) {
    throw new Error('Run proof:tool-workflow from the repository root');
  }
  assertClean(repositoryRoot);
  const head = git(repositoryRoot, ['rev-parse', 'HEAD']);
  const revisions = validateProofRevisions({
    ...options,
    head,
    isCommit: (revision) => isCommit(repositoryRoot, revision),
    isAncestor: (baseline, current) =>
      isAncestor(repositoryRoot, baseline, current),
  });
  const startedAt = new Date().toISOString();
  const fixtureRoot = path.join(
    repositoryRoot,
    'apps/tools/benchmarks/fixtures',
  );
  const fixtures = {
    bmp: readFileSync(path.join(fixtureRoot, 'sample.bmp')),
    jpeg: readFileSync(path.join(fixtureRoot, 'sample.jpg')),
    png: readFileSync(path.join(fixtureRoot, 'sample.png')),
  };

  process.stdout.write(`Replaying baseline ${revisions.baseline}...\n`);
  const baseline = await evaluateRevision(
    repositoryRoot,
    revisions.baseline,
    'baseline',
    fixtures,
  );
  process.stdout.write(`Replaying current ${revisions.current}...\n`);
  const current = await evaluateRevision(
    repositoryRoot,
    revisions.current,
    'current',
    fixtures,
  );
  if (
    baseline.some(({ verdict }) => verdict === 'blocked') ||
    current.some(({ verdict }) => verdict === 'blocked')
  ) {
    throw new Error(
      `Dual-browser runtime proof is BLOCKED:\n${JSON.stringify({ baseline, current }, null, 2)}`,
    );
  }

  const [{ runCurrentSeamProbes }] = await Promise.all([
    import('./lib/tool-workflow-proof-seam-probes.ts'),
  ]);
  const seamProbes = await runCurrentSeamProbes({
    pngBytes: fixtures.png,
    jpegBytes: fixtures.jpeg,
  });
  const pnpmVersion = run('pnpm', ['--version'], {
    cwd: repositoryRoot,
    env: process.env,
  });
  const commands = [
    `pnpm proof:tool-workflow -- --baseline ${revisions.baseline} --current ${revisions.current}`,
    `node scripts/verify-tool-workflow-ownership.mjs --ref ${revisions.baseline} --json`,
    `node scripts/verify-tool-workflow-ownership.mjs --ref ${revisions.current} --json`,
    `pnpm --silent audit:tool-coverage -- --source-revision ${revisions.current}`,
  ];
  const comparison = finalizeComparison({
    baseline: revisions.baseline,
    current: revisions.current,
    evaluatorRevision: head,
    generatedAt: new Date().toISOString(),
    runtime: { baseline, current },
    seamProbes,
    ownership: {
      baseline: ownershipAt(repositoryRoot, revisions.baseline),
      current: ownershipAt(repositoryRoot, revisions.current),
    },
    portfolio: currentPortfolio(repositoryRoot, revisions.current),
    environment: {
      node: process.versions.node,
      pnpm: pnpmVersion,
      platform: `${process.platform}-${process.arch}`,
    },
    commands,
  });
  const artifactRoot = writeArtifact({
    repositoryRoot,
    comparison,
    current: revisions.current,
    startedAt,
    completedAt: new Date().toISOString(),
  });
  process.stdout.write(
    `Local before/after proof: PASS\nArtifact: ${artifactRoot}\nReport: ${path.join(artifactRoot, 'report.html')}\nServe locally: python3 -m http.server 8765 --directory ${artifactRoot}\nThen open: http://127.0.0.1:8765/report.html\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
