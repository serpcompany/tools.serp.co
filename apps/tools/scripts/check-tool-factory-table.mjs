import assert from 'node:assert/strict';

import { chromium } from 'playwright';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(new URL('/internal/tools', baseUrl).href, {
    waitUntil: 'networkidle',
  });
  await page.getByRole('heading', { name: 'All Tools' }).waitFor();
  await page.getByText('LOCAL', { exact: true }).waitFor();
  await page.getByText('Revision working-copy', { exact: true }).waitFor();
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

  assert.deepEqual(pageErrors, []);
  process.stdout.write('Tool Factory table browser check passed\n');
} finally {
  await browser.close();
}
