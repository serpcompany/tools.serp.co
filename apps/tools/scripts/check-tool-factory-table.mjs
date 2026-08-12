import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { recordRunEvidence } from '../../../scripts/lib/run-evidence.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(appRoot, '..', '..');
const wrangler = JSON.parse(
  readFileSync(path.join(appRoot, 'wrangler.jsonc'), 'utf8'),
);
const canonicalPreviewOrigin =
  wrangler.env?.['wayfinder-preview']?.vars?.NEXT_PUBLIC_SITE_URL;

function repositoryState() {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
  const dirty =
    execFileSync('git', ['status', '--short', '--untracked-files=all'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }).trim() !== '';
  return { revision, dirty };
}

function parseArgs(argv) {
  const result = {
    baseUrl: 'http://127.0.0.1:3000',
    environment: 'LOCAL',
    revision: 'working-copy',
    screenshot: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--base-url') result.baseUrl = argv[++index] ?? '';
    else if (argument === '--environment')
      result.environment = argv[++index] ?? '';
    else if (argument === '--revision') result.revision = argv[++index] ?? '';
    else if (argument === '--screenshot')
      result.screenshot = argv[++index] ?? '';
    else throw new Error(`Unknown Tool Factory check argument: ${argument}`);
  }
  const url = new URL(result.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('--base-url must use HTTP or HTTPS');
  }
  if (!new Set(['LOCAL', 'DEV/STAGING']).has(result.environment)) {
    throw new Error('--environment must be LOCAL or DEV/STAGING');
  }
  if (
    result.environment === 'DEV/STAGING' &&
    (!/^[a-f0-9]{40}$/.test(result.revision) ||
      url.protocol !== 'https:' ||
      url.origin !== canonicalPreviewOrigin)
  ) {
    throw new Error(
      'DEV/STAGING checks require the full revision and canonical Wayfinder origin',
    );
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
const source = repositoryState();
if (
  args.environment === 'LOCAL' &&
  !new Set(['working-copy', source.revision]).has(args.revision)
) {
  throw new Error('LOCAL revision must be working-copy or the checked-out HEAD');
}
if (
  args.environment === 'DEV/STAGING' &&
  (source.dirty || source.revision !== args.revision)
) {
  throw new Error('DEV/STAGING checks require a clean matching checkout');
}
const startedAt = new Date();
let browser;
let status = 'failure';
const accessCookie = process.env.TOOL_FACTORY_CF_AUTHORIZATION ?? '';
if (args.environment === 'LOCAL' && accessCookie) {
  throw new Error('LOCAL checks refuse Cloudflare Access credentials');
}
if (args.environment === 'DEV/STAGING' && !accessCookie) {
  throw new Error('DEV/STAGING checks require Cloudflare Access');
}

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });
  if (args.environment === 'DEV/STAGING') {
    const origin = new URL(args.baseUrl);
    await context.addCookies([
      {
        name: 'CF_Authorization',
        value: accessCookie,
        domain: origin.hostname,
        path: '/',
        httpOnly: true,
        secure: origin.protocol === 'https:',
        sameSite: 'Lax',
      },
    ]);
  }
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(new URL('/internal/tools', args.baseUrl).href, {
    waitUntil: 'networkidle',
  });
  await page.getByRole('heading', { name: 'All Tools' }).waitFor();
  await page.getByText(args.environment, { exact: true }).waitFor();
  await page
    .getByText(`Revision ${args.revision}`, { exact: true })
    .waitFor();
  await page
    .getByText(
      '2,807 active Tools · 431 supported · 2,373 explicitly unsupported · 3 unknown',
    )
    .waitFor();

  await page.getByLabel('Search all Tools').fill('audio-to-text');
  await page.getByText('1 matching Tools').waitFor();
  await page.getByRole('row', { name: /Audio to Text/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('@xenova/transformers', { exact: true }).waitFor();
  await dialog.getByText('Runtime observation', { exact: true }).waitFor();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Reset' }).click();
  await page.getByLabel('Filter by support').selectOption('unsupported');
  await page.getByText('2,373 matching Tools').waitFor();

  await page.getByText('Columns', { exact: true }).click();
  await page.getByLabel('Description').check();
  await page.getByRole('columnheader', { name: /Description/ }).waitFor();

  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByText('page 2 of 48').waitFor();

  if (args.screenshot) await page.screenshot({ path: args.screenshot });

  assert.deepEqual(pageErrors, []);
  status = 'success';
  process.stdout.write(
    `Tool Factory table browser check passed for ${args.environment} at ${args.revision}\n`,
  );
} finally {
  await browser?.close();
  const completedAt = new Date();
  const evidence = recordRunEvidence({
    repositoryRoot,
    command: 'check:tool-factory',
    commandVersion: '1',
    revision: source.revision,
    dirty: args.environment === 'LOCAL' ? source.dirty : false,
    environment: args.environment === 'DEV/STAGING' ? 'pull-request' : 'local',
    scope: 'tool-factory-table',
    status,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    linkedWork: ['#50', '#107'],
    summary: {
      status,
      checksPassed: status === 'success' ? 6 : 0,
      checksFailed: status === 'success' ? 0 : 1,
      items: 1,
      durationMs: completedAt.valueOf() - startedAt.valueOf(),
    },
  });
  process.stdout.write(`Structured artifact: ${evidence.runId}\n`);
}
