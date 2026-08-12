import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { recordRunEvidence } from '../../../scripts/lib/run-evidence.mjs';

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
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
  throw new Error(
    'LOCAL revision must be working-copy or the checked-out HEAD',
  );
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

async function waitForHydration(page) {
  await page.waitForFunction(
    () => {
      const input = globalThis.document.querySelector(
        'input[aria-label="Search all Tools"]',
      );
      return (
        input &&
        Object.keys(input).some(
          (key) =>
            key.startsWith('__reactFiber') || key.startsWith('__reactProps'),
        )
      );
    },
    undefined,
    { timeout: 30_000 },
  );
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
  await page.getByText(`Revision ${args.revision}`, { exact: true }).waitFor();
  await page
    .getByText(
      '2,807 active Tools · 431 supported · 2,373 explicitly unsupported · 3 unknown',
    )
    .waitFor();
  await waitForHydration(page);

  await page.getByLabel('Search all Tools').fill('png-to-webp');
  await page.getByText('1 matching Tools').waitFor();
  await page.getByRole('row', { name: /PNG to WebP/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Latest exact Tool test', { exact: true }).waitFor();
  await dialog.getByText('Passed', { exact: true }).waitFor();
  await dialog
    .getByText('Converted a real PNG and produced a WebP file.', {
      exact: true,
    })
    .waitFor();
  await dialog.getByText('DEV/STAGING preview', { exact: true }).waitFor();
  await dialog.getByRole('link', { name: 'View screenshot' }).waitFor();
  await dialog
    .getByText(
      '20260812T083305Z_03dc90f_pull-request_browser-smoke-preview-subset',
      { exact: true },
    )
    .waitFor();
  await dialog
    .getByText('Family verification policy (not an exact Tool test)', {
      exact: true,
    })
    .waitFor();
  await dialog.getByText('GitHub work', { exact: true }).waitFor();
  assert.equal(
    await dialog.getByText('No tracked work', { exact: true }).count(),
    1,
  );
  await dialog.getByText('Work tracking not loaded', { exact: true }).waitFor();
  await dialog.getByText(/point-in-time snapshot/).waitFor();
  await page.keyboard.press('Escape');

  await page.getByLabel('Search all Tools').fill('bmp-to-png');
  await page.getByRole('row', { name: /BMP to PNG/ }).click();
  const untestedDialog = page.getByRole('dialog');
  await untestedDialog.getByText('Not tested here', { exact: true }).waitFor();
  assert.equal(
    await untestedDialog.getByRole('link', { name: 'View screenshot' }).count(),
    0,
  );
  await untestedDialog
    .getByText('Family verification policy (not an exact Tool test)', {
      exact: true,
    })
    .waitFor();
  await page.keyboard.press('Escape');

  await page.getByLabel('Search all Tools').fill('audio-to-text');
  await page.getByRole('row', { name: /Audio to Text/ }).click();
  const familyDialog = page.getByRole('dialog');
  await familyDialog
    .getByText('Family test evidence — not an exact Tool test', { exact: true })
    .waitFor();
  await familyDialog
    .getByText(
      'The representative family browser run included real speech transcription for this Tool.',
      { exact: true },
    )
    .waitFor();
  await familyDialog
    .getByText(
      'Family tested revision 03dc90f5213560ff61493dd058b877f9666b8338',
      { exact: true },
    )
    .waitFor();
  const githubWorkHeading = familyDialog.getByText('GitHub work', {
    exact: true,
  });
  await githubWorkHeading.waitFor();
  await familyDialog
    .getByRole('heading', { name: 'Family · renderer:transcription' })
    .waitFor();
  assert.equal(
    await familyDialog.getByText('Open pull request', { exact: true }).count(),
    2,
  );
  assert.equal(
    await familyDialog.getByText('Closed issue', { exact: true }).count(),
    1,
  );
  await familyDialog
    .getByRole('link', {
      name: 'Fix Audio-to-Text for real YouTube links on Cloudflare',
    })
    .waitFor();
  await familyDialog
    .getByRole('link', {
      name: 'Draft foundation — do not merge to main: Tool workflow architecture',
    })
    .waitFor();
  if (args.screenshot) {
    await githubWorkHeading.locator('..').screenshot({ path: args.screenshot });
  }
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Reset' }).click();
  await page.getByLabel('Search all Tools').fill('to');
  await page.getByLabel('Filter by support').selectOption('unsupported');
  await page
    .getByLabel('Filter by family')
    .selectOption('generic-convert:adaptive-video');
  await page
    .getByLabel('Filter by execution profile')
    .selectOption('client-only, server-assisted, server-executed');
  await page
    .getByLabel('Filter by verification')
    .selectOption('explicit-fail-closed-contract');
  const matchingLabel = page.getByText(/^\d[\d,]* matching Tools/);
  const matchingText = await matchingLabel.textContent();
  const matchingCount = Number(
    matchingText?.match(/[\d,]+/)?.[0].replace(',', ''),
  );
  assert.ok(matchingCount > 25);

  await page.getByText('Columns', { exact: true }).click();
  await page.getByLabel('Description').check();
  await page.getByRole('columnheader', { name: /Description/ }).waitFor();

  await page.getByLabel('Rows per page').selectOption('25');
  const sharedPageCount = Math.ceil(matchingCount / 25);
  await page.getByText(`page 1 of ${sharedPageCount}`).waitFor();
  await page.getByRole('button', { name: 'Tool', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByText(`page 2 of ${sharedPageCount}`).waitFor();
  const expectedFirstRow = await page.locator('tbody tr').first().innerText();

  const sharedUrl = new URL(page.url());
  assert.equal(sharedUrl.searchParams.get('q'), 'to');
  assert.equal(sharedUrl.searchParams.get('support'), 'unsupported');
  assert.equal(
    sharedUrl.searchParams.get('family'),
    'generic-convert:adaptive-video',
  );
  assert.equal(
    sharedUrl.searchParams.get('profile'),
    'client-only, server-assisted, server-executed',
  );
  assert.equal(
    sharedUrl.searchParams.get('verification'),
    'explicit-fail-closed-contract',
  );
  assert.equal(sharedUrl.searchParams.get('rows'), '25');
  assert.equal(sharedUrl.searchParams.get('page'), '2');
  assert.equal(sharedUrl.searchParams.get('sort'), 'tool:asc');
  assert.match(sharedUrl.searchParams.get('columns') ?? '', /description/);

  await page.reload({ waitUntil: 'networkidle' });
  await waitForHydration(page);
  await page
    .getByText(`${matchingCount.toLocaleString()} matching Tools`)
    .waitFor();
  await page.getByText(`page 2 of ${sharedPageCount}`).waitFor();
  assert.equal(await page.getByLabel('Search all Tools').inputValue(), 'to');
  assert.equal(
    await page.getByLabel('Filter by support').inputValue(),
    'unsupported',
  );
  assert.equal(
    await page.getByLabel('Filter by family').inputValue(),
    'generic-convert:adaptive-video',
  );
  assert.equal(
    await page.getByLabel('Filter by execution profile').inputValue(),
    'client-only, server-assisted, server-executed',
  );
  assert.equal(
    await page.getByLabel('Filter by verification').inputValue(),
    'explicit-fail-closed-contract',
  );
  assert.equal(await page.getByLabel('Rows per page').inputValue(), '25');
  await page.getByRole('columnheader', { name: /Description/ }).waitFor();
  assert.equal(
    await page.locator('tbody tr').first().innerText(),
    expectedFirstRow,
  );

  const copiedPage = await context.newPage();
  const copiedErrors = [];
  copiedPage.on('pageerror', (error) => copiedErrors.push(error.message));
  await copiedPage.goto(sharedUrl.href, { waitUntil: 'networkidle' });
  await waitForHydration(copiedPage);
  await copiedPage
    .getByText(`${matchingCount.toLocaleString()} matching Tools`)
    .waitFor();
  await copiedPage.getByText(`page 2 of ${sharedPageCount}`).waitFor();
  await copiedPage.getByRole('columnheader', { name: /Description/ }).waitFor();
  assert.equal(
    await copiedPage.locator('tbody tr').first().innerText(),
    expectedFirstRow,
  );
  assert.deepEqual(copiedErrors, []);
  await copiedPage.close();

  await page.goBack({ waitUntil: 'networkidle' });
  await page.getByText(`page 1 of ${sharedPageCount}`).waitFor();
  await page.goForward({ waitUntil: 'networkidle' });
  await page.getByText(`page 2 of ${sharedPageCount}`).waitFor();
  assert.equal(
    await page.locator('tbody tr').first().innerText(),
    expectedFirstRow,
  );

  await page.getByRole('button', { name: 'Reset' }).click();
  assert.equal(new URL(page.url()).search, '');
  await page.getByText('2,807 matching Tools').waitFor();
  assert.equal(await page.getByLabel('Rows per page').inputValue(), '50');
  assert.equal(
    await page.getByRole('columnheader', { name: /Description/ }).count(),
    0,
  );

  await page.goto(
    new URL(
      '/internal/tools?support=retired&sort=missing%3Asideways&columns=missing&page=999999&rows=999',
      args.baseUrl,
    ).href,
    { waitUntil: 'networkidle' },
  );
  await waitForHydration(page);
  await page.getByText('2,807 matching Tools').waitFor();
  await page.getByText('page 57 of 57').waitFor();
  assert.equal(new URL(page.url()).search, '?page=57');
  assert.equal(await page.getByLabel('Rows per page').inputValue(), '50');

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
    linkedWork: ['#50', '#104', '#105', '#106', '#107'],
    summary: {
      status,
      checksPassed: status === 'success' ? 17 : 0,
      checksFailed: status === 'success' ? 0 : 1,
      items: 1,
      durationMs: completedAt.valueOf() - startedAt.valueOf(),
    },
  });
  process.stdout.write(`Structured artifact: ${evidence.runId}\n`);
}
