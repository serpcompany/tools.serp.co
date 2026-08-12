import assert from 'node:assert/strict';

import { chromium } from 'playwright';

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
  if (
    result.environment === 'DEV/STAGING' &&
    !/^[a-f0-9]{40}$/.test(result.revision)
  ) {
    throw new Error('Hosted checks require the full deployed revision');
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });
  const accessCookie = process.env.TOOL_FACTORY_CF_AUTHORIZATION;
  if (accessCookie) {
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
  process.stdout.write(
    `Tool Factory table browser check passed for ${args.environment} at ${args.revision}\n`,
  );
} finally {
  await browser.close();
}
