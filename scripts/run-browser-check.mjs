import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { operationalToolCatalog } from '../packages/app-core/src/lib/tool-catalog-adapter.mjs';
import { recordRunEvidence } from './lib/run-evidence.mjs';
import {
  buildBrowserScope,
  summarizeNavigationTimings,
} from './lib/browser-evidence.mjs';
import {
  GENERIC_SMOKE_CAPABILITY_VERSION,
  getGenericSmokeExpectation,
} from './lib/generic-smoke-capabilities.mjs';
import { readTranscriptionTerminalState } from './lib/transcription-browser-state.mjs';

function parseArguments(arguments_) {
  const tokens = arguments_.filter((argument) => argument !== '--');
  const options = {
    mode: '',
    environment: '',
    revision: '',
    baseUrl: process.env.TOOLS_BASE_URL ?? 'http://localhost:3000',
    dirty: false,
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--help' || token === '-h') {
      console.log(
        [
          'Usage: node scripts/run-browser-check.mjs --mode <smoke|benchmark> --environment <local|preview|production> --revision <40-character-commit> [options]',
          '',
          '  --mode <smoke|benchmark>               Required. Smoke checks correctness; benchmark measures performance.',
          '  --environment <local|preview|production> Required target environment.',
          '  --revision <40-character-commit>         Required exact target revision.',
          '  --base-url <url>                         Browser target; defaults to TOOLS_BASE_URL or localhost.',
          '  --dirty                                  Mark local uncommitted inputs.',
          '',
          'Every run writes a structured artifact; raw browser results are not retained.',
        ].join('\n'),
      );
      process.exit(0);
    }
    if (token === '--dirty') {
      options.dirty = true;
      continue;
    }
    const field = new Map([
      ['--mode', 'mode'],
      ['--environment', 'environment'],
      ['--revision', 'revision'],
      ['--base-url', 'baseUrl'],
    ]).get(token);
    if (field !== undefined) {
      options[field] = tokens[index + 1] ?? '';
      index += 1;
      continue;
    }
    throw new Error('Unknown browser runner argument');
  }
  if (!new Set(['smoke', 'benchmark']).has(options.mode)) {
    throw new Error('--mode is required and must be smoke or benchmark');
  }
  if (!new Set(['local', 'preview', 'production']).has(options.environment)) {
    throw new Error(
      '--environment is required and must be local, preview, or production',
    );
  }
  if (!/^[a-f0-9]{40}$/.test(options.revision)) {
    throw new Error('--revision requires the full 40-character target commit');
  }
  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(options.baseUrl);
  } catch {
    throw new Error('--base-url must be a sanitized target origin');
  }
  const loopbackTarget = new Set(['localhost', '127.0.0.1', '::1']).has(
    parsedBaseUrl.hostname,
  );
  const validProtocol =
    parsedBaseUrl.protocol === 'https:' ||
    (options.environment === 'local' && parsedBaseUrl.protocol === 'http:');
  if (
    !validProtocol ||
    (options.environment === 'local' && !loopbackTarget) ||
    (options.environment !== 'local' && loopbackTarget) ||
    parsedBaseUrl.username ||
    parsedBaseUrl.password ||
    parsedBaseUrl.pathname !== '/' ||
    parsedBaseUrl.search ||
    parsedBaseUrl.hash
  ) {
    throw new Error('--base-url must be a sanitized target origin');
  }
  if (options.dirty && options.environment !== 'local') {
    throw new Error('--dirty is accepted only for local browser runs');
  }
  return options;
}

let options;
try {
  options = parseArguments(process.argv.slice(2));
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : 'Browser runner arguments are invalid',
  );
  process.exit(1);
}

const defaultRepositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = defaultRepositoryRoot;
const evidenceRepositoryRoot =
  process.env.NODE_ENV === 'test' && process.env.TOOLS_SERP_TEST_REPOSITORY_ROOT
    ? path.resolve(process.env.TOOLS_SERP_TEST_REPOSITORY_ROOT)
    : defaultRepositoryRoot;
const startedAt = new Date();
const modeConfiguration = Object.freeze({
  smoke: { command: 'smoke:tools:browser', handler: 'smoke' },
  benchmark: { command: 'benchmark:tools:browser', handler: 'benchmark' },
});
const evidenceEnvironments = Object.freeze({
  local: 'local',
  preview: 'pull-request',
  production: 'main',
});
const selectedMode = modeConfiguration[options.mode];
let evidenceScope = `browser-${options.mode}-${options.environment}-initialization`;
let evidenceInputHashes = [];
let evidenceTools = [];
let selectedItemCount = 0;
let browser;
const results = [];

function recordBrowserEvidence(status, summary, completedAt = new Date()) {
  return recordRunEvidence({
    repositoryRoot: evidenceRepositoryRoot,
    command: selectedMode.command,
    commandVersion: '1',
    revision: options.revision,
    environment: evidenceEnvironments[options.environment],
    scope: evidenceScope,
    status,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    dirty: options.dirty,
    inputHashes: evidenceInputHashes,
    tools: evidenceTools,
    linkedWork: ['#58'],
    summary: {
      status,
      ...summary,
      durationMs: completedAt.valueOf() - startedAt.valueOf(),
    },
  });
}

try {
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const fixturesDir = path.join(repositoryRoot, 'apps/tools/benchmarks');
  const fixtureMatrixPath = path.join(fixturesDir, 'fixture-matrix.json');

  let tools = [...operationalToolCatalog.activeTools];
  const toolFilter = process.env.TOOLS_ONLY
    ? process.env.TOOLS_ONLY.split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    : null;
  if (toolFilter?.length) {
    const filterSet = new Set(toolFilter);
    tools = tools.filter((tool) => filterSet.has(tool.id));
  }
  const toolLimit =
    process.env.TOOLS_LIMIT === undefined
      ? null
      : Number(process.env.TOOLS_LIMIT);
  if (
    toolLimit !== null &&
    (!Number.isSafeInteger(toolLimit) || toolLimit < 1)
  ) {
    throw new Error('TOOLS_LIMIT must be a positive integer');
  }
  if (toolLimit !== null) {
    tools = tools.slice(0, toolLimit);
  }
  selectedItemCount = tools.length;
  const browserScope = buildBrowserScope({
    mode: options.mode,
    environment: options.environment,
    toolIds: tools.map((tool) => tool.id),
    filtered: Boolean(toolFilter?.length || toolLimit),
  });
  evidenceScope = browserScope.label;
  evidenceInputHashes = browserScope.inputHashes;
  evidenceTools = browserScope.tools;
  if (tools.length === 0) {
    throw new Error('Browser check selected no active Tools');
  }
  if (
    process.env.NODE_ENV === 'test' &&
    process.env.TOOLS_SERP_TEST_BROWSER_FAILURE === 'initialization'
  ) {
    throw new Error('Injected browser initialization failure');
  }
  const fixtureMatrix = JSON.parse(
    await fs.readFile(fixtureMatrixPath, 'utf8'),
  );
  const formatFixtures = new Map(
    (fixtureMatrix.formats ?? []).map((entry) => [entry.format, entry]),
  );
  const toolFixtures = fixtureMatrix.toolFixtures ?? {};

  const textOnlyTools = new Set([
    'json-to-csv',
    'html-to-markdown',
    'character-counter',
  ]);
  const specializedSmokeTools = new Set([
    'json-to-csv',
    'csv-combiner',
    'html-to-markdown',
    'character-counter',
  ]);

  const { chromium } = await import('playwright');

  const MIME_MAP = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    ai: 'application/pdf',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    pdf: 'application/pdf',
    svg: 'image/svg+xml',
    heic: 'image/heic',
    heif: 'image/heif',
    ico: 'image/x-icon',
    cur: 'image/x-icon',
    avif: 'image/avif',
    tiff: 'image/tiff',
    tif: 'image/tiff',
    tga: 'image/x-tga',
    dds: 'image/vnd-ms.dds',
    psd: 'image/vnd.adobe.photoshop',
    mp4: 'video/mp4',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    qt: 'video/quicktime',
    m4v: 'video/x-m4v',
    mpeg: 'video/mpeg',
    mpg: 'video/mpeg',
    m2v: 'video/mpeg',
    ts: 'video/mp2t',
    mts: 'video/mp2t',
    m2ts: 'video/mp2t',
    flv: 'video/x-flv',
    f4v: 'video/x-f4v',
    vob: 'video/dvd',
    '3gp': 'video/3gpp',
    '3g2': 'video/3gpp2',
    dv: 'video/dv',
    mxf: 'application/mxf',
    wtv: 'video/x-ms-wtv',
    hevc: 'video/mp4',
    divx: 'video/avi',
    mjpeg: 'video/x-motion-jpeg',
    asf: 'video/x-ms-asf',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    aac: 'audio/aac',
    m4a: 'audio/mp4',
    m4r: 'audio/mp4',
    m4b: 'audio/mp4',
    opus: 'audio/opus',
    flac: 'audio/flac',
    wma: 'audio/x-ms-wma',
    aiff: 'audio/aiff',
    aifc: 'audio/aiff',
    mp2: 'audio/mpeg',
    alac: 'audio/mp4',
    amr: 'audio/amr',
    gsm: 'audio/gsm',
    dss: 'audio/x-dss',
    ra: 'audio/x-realaudio',
    au: 'audio/basic',
    caf: 'audio/x-caf',
    cdda: 'audio/x-cdda',
    av1: 'video/mp4',
    avchd: 'video/mp2t',
    m4p: 'audio/mp4',
    mpv: 'video/mp4',
    txt: 'text/plain',
    csv: 'text/csv',
  };

  function getExpectedMimeType(format) {
    if (!format) return 'application/octet-stream';
    return MIME_MAP[format.toLowerCase()] || 'application/octet-stream';
  }

  const fixtureCache = new Map();

  function resolveFixturePath(relativePath) {
    if (!relativePath) return null;
    return path.join(fixturesDir, relativePath);
  }

  function getFormatFixture(format) {
    if (!format) return null;
    const entry = formatFixtures.get(format);
    if (!entry || entry.status !== 'ready' || !entry.fixture) return null;
    return { entry, path: resolveFixturePath(entry.fixture) };
  }

  browser = await chromium.launch();

  async function waitForHydration(page) {
    await page.waitForFunction(
      () => {
        const input = document.querySelector(
          '[data-testid="tool-file-input"], input[type="file"]',
        );
        if (!input) return true;
        const keys = Object.keys(input);
        return keys.some(
          (key) =>
            key.startsWith('__reactFiber') || key.startsWith('__reactProps'),
        );
      },
      null,
      { timeout: 15000 },
    );
  }

  async function getFixtureFile(filePath) {
    if (fixtureCache.has(filePath)) return fixtureCache.get(filePath);
    const buffer = await fs.readFile(filePath);
    const file = {
      name: path.basename(filePath),
      type: getExpectedMimeType(path.extname(filePath).slice(1)),
      base64: buffer.toString('base64'),
    };
    fixtureCache.set(filePath, file);
    return file;
  }

  async function dropFilesOnDropzone(page, selector, filePaths) {
    const files = [];
    for (const filePath of filePaths) {
      if (!filePath) continue;
      files.push(await getFixtureFile(filePath));
    }
    if (!files.length) {
      throw new Error('No files available for dropzone upload.');
    }

    await page.evaluate(
      ({ selector, files }) => {
        const dropzone = document.querySelector(selector);
        if (!dropzone) {
          throw new Error(`Missing dropzone ${selector}`);
        }
        const dataTransfer = new DataTransfer();
        for (const file of files) {
          const bytes = Uint8Array.from(atob(file.base64), (char) =>
            char.charCodeAt(0),
          );
          const blob = new Blob([bytes], {
            type: file.type || 'application/octet-stream',
          });
          const fileHandle = new File([blob], file.name, {
            type: file.type || 'application/octet-stream',
          });
          dataTransfer.items.add(fileHandle);
        }
        const buildEvent = (type) => {
          try {
            return new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              dataTransfer,
            });
          } catch {
            const event = new Event(type, { bubbles: true, cancelable: true });
            Object.defineProperty(event, 'dataTransfer', {
              value: dataTransfer,
            });
            return event;
          }
        };
        dropzone.dispatchEvent(buildEvent('dragenter'));
        dropzone.dispatchEvent(buildEvent('dragover'));
        dropzone.dispatchEvent(buildEvent('drop'));
      },
      { selector, files },
    );
  }

  async function hookBlobCapture(page) {
    await page.evaluate(() => {
      if (!window.__origCreateObjectURL) {
        window.__origCreateObjectURL = URL.createObjectURL;
      }
      URL.createObjectURL = (blob) => {
        if (!window.__blobEvents) window.__blobEvents = [];
        window.__blobEvents.push({
          size: blob?.size ?? null,
          type: blob?.type ?? null,
          time: Date.now(),
        });
        window.__lastBlobSize = blob?.size ?? null;
        window.__lastBlobType = blob?.type ?? null;
        window.__lastBlob = blob;
        return window.__origCreateObjectURL(blob);
      };
      window.__blobEvents = [];
      window.__lastBlobSize = null;
      window.__lastBlobType = null;
      window.__lastBlob = null;
    });
  }

  async function waitForBlob(page, minEvents = 1, timeout = 15000) {
    await page.waitForFunction(
      (count) =>
        Array.isArray(window.__blobEvents) &&
        window.__blobEvents.length >= count,
      minEvents,
      { timeout },
    );
    return page.evaluate(
      () => window.__blobEvents[window.__blobEvents.length - 1],
    );
  }

  async function runFunctionalTest(page, tool) {
    function assertCsvToJsonRecords(records) {
      if (
        !Array.isArray(records) ||
        records.length !== 2 ||
        records[0]?.name !== 'Ada' ||
        records[0]?.count !== '1' ||
        records[1]?.name !== 'Grace' ||
        records[1]?.count !== '2'
      ) {
        throw new Error(
          'CSV to JSON output did not preserve rows, headers, and cell values.',
        );
      }
    }

    if (tool.id === 'video-downloader') {
      const fixture = toolFixtures[tool.id];
      const fixturePath = resolveFixturePath(fixture?.responseFixture);
      if (options.environment !== 'local' || !fixturePath || !fixture?.url) {
        return { skipped: true, reason: 'missing local downloader fixture' };
      }
      const media = await fs.readFile(fixturePath);
      await page.route('**/api/media-fetch*', async (route) => {
        await route.fulfill({
          status: 200,
          headers: {
            'content-length': String(media.byteLength),
            'content-type': 'video/mp4',
            'x-media-extension': 'mp4',
            'x-media-filename': 'deterministic-video.mp4',
          },
          body: media,
        });
      });
      await hookBlobCapture(page);
      await page.fill('[data-testid="tool-url-input"]', fixture.url);
      await page.click('[data-testid="tool-url-submit"]');
      await page.waitForFunction(
        () =>
          document.querySelector(
            '[data-testid="video-progress"][data-status="completed"], [data-testid="video-progress"][data-status="error"]',
          ) !== null,
        null,
        { timeout: 20_000 },
      );
      const terminal = await page.$('[data-testid="video-progress"]');
      if ((await terminal?.getAttribute('data-status')) === 'error') {
        throw new Error(
          `Downloader failed: ${(await terminal?.textContent())?.trim() || 'unknown error'}`,
        );
      }
      const blob = await waitForBlob(page, 1, 20_000);
      if (!blob?.size || blob.type !== 'video/mp4') {
        throw new Error(
          'Downloader URL flow did not deliver verified MP4 media',
        );
      }
      return {
        detail: `download ${blob.size} bytes`,
        metrics: { outputBytes: blob.size, outputType: blob.type },
      };
    }

    if (tool.id === 'png-to-png' || tool.route === '/compress-png') {
      const fixtureEntry = getFormatFixture('png');
      if (!fixtureEntry) {
        return { skipped: true, reason: 'missing png fixture' };
      }
      const inputSize = (await fs.stat(fixtureEntry.path)).size;
      await hookBlobCapture(page);
      await dropFilesOnDropzone(page, '[data-testid="tool-dropzone"]', [
        fixtureEntry.path,
      ]);
      await page.waitForSelector('[data-testid="video-progress"]', {
        timeout: 15000,
      });
      await page.waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="video-progress"]');
          const text = el?.textContent?.toLowerCase() ?? '';
          return text.includes('complete');
        },
        null,
        { timeout: 20000 },
      );
      const blob = await waitForBlob(page, 1, 20000);
      if (!blob?.size) {
        throw new Error('Compression did not produce output blob.');
      }
      const compressionDelta = blob?.size - inputSize;
      if (compressionDelta > 0) {
        return {
          detail: `compressed ${inputSize} -> ${blob?.size ?? '?'} (larger by ${compressionDelta} bytes)`,
          metrics: { inputBytes: inputSize, outputBytes: blob?.size ?? null },
          warning: 'compressed file larger than input',
        };
      }
      return {
        detail: `compressed ${inputSize} -> ${blob?.size ?? '?'}`,
        metrics: { inputBytes: inputSize, outputBytes: blob?.size ?? null },
      };
    }

    if (tool.id === 'batch-compress-png') {
      await hookBlobCapture(page);
      const batchFixtures = toolFixtures['batch-compress-png']?.fixtures ?? [];
      const batchPaths = batchFixtures.map(resolveFixturePath).filter(Boolean);
      if (batchPaths.length < 2) {
        return { skipped: true, reason: 'missing batch fixtures' };
      }
      await dropFilesOnDropzone(
        page,
        '[data-testid="batch-compress-dropzone"]',
        batchPaths,
      );
      await page.waitForFunction(
        () => {
          return document.body.textContent?.includes('Compressing file');
        },
        null,
        { timeout: 15000 },
      );
      await page.waitForSelector('[data-testid="batch-compress-download"]', {
        timeout: 20000,
      });
      const beforeCount = await page.evaluate(
        () => window.__blobEvents?.length ?? 0,
      );
      await page.click('[data-testid="batch-compress-download"]');
      await page.waitForFunction(
        (count) =>
          Array.isArray(window.__blobEvents) &&
          window.__blobEvents.length > count,
        beforeCount,
        { timeout: 20000 },
      );
      const blob = await page.evaluate(
        () => window.__blobEvents[window.__blobEvents.length - 1],
      );
      if (!blob?.size) {
        throw new Error('Batch compression did not produce output blob.');
      }
      return {
        detail: `zip size ${blob?.size ?? '?'}`,
        metrics: {
          outputBytes: blob?.size ?? null,
          outputType: blob?.type ?? null,
        },
      };
    }

    if (tool.id === 'json-to-csv') {
      const jsonFixture = toolFixtures['json-to-csv']?.fixture;
      const jsonPath = resolveFixturePath(jsonFixture);
      const jsonText = jsonPath ? await fs.readFile(jsonPath, 'utf8') : null;
      if (!jsonText) {
        return { skipped: true, reason: 'missing json fixture' };
      }
      await hookBlobCapture(page);
      await page.fill('[data-testid="json-input"]', jsonText);
      await page.click('[data-testid="json-convert"]');
      await page.waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="csv-output"]');
          return el && el.value && el.value.length > 0;
        },
        null,
        { timeout: 10000 },
      );
      const output = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="csv-output"]');
        return el?.value ?? '';
      });
      const header =
        output
          .split('\n')[0]
          ?.split(',')
          .map((value) => value.trim()) ?? [];
      if (!header.includes('name') || !header.includes('count')) {
        throw new Error('JSON to CSV output missing expected headers.');
      }
      const downloadButton = await page.$('button:has-text("Download CSV")');
      if (downloadButton) {
        const beforeCount = await page.evaluate(
          () => window.__blobEvents?.length ?? 0,
        );
        await downloadButton.click();
        await page.waitForFunction(
          (count) =>
            Array.isArray(window.__blobEvents) &&
            window.__blobEvents.length > count,
          beforeCount,
          { timeout: 10000 },
        );
      }
      const blob = await page.evaluate(
        () => window.__blobEvents?.[window.__blobEvents.length - 1],
      );
      return {
        detail: `output ${output.split('\n').length} lines`,
        metrics: {
          outputBytes: blob?.size ?? null,
          outputType: blob?.type ?? null,
        },
      };
    }

    if (tool.id === 'csv-to-json') {
      const input = 'name,count\nAda,1\nGrace,2\n';
      await hookBlobCapture(page);
      await page.fill('[data-testid="table-source-input"]', input);
      await page.click('[data-testid="table-convert-run"]');
      await page.waitForFunction(
        () =>
          Boolean(
            document.querySelector('[data-testid="table-output"]')?.value,
          ),
        null,
        { timeout: 10_000 },
      );
      const output = await page
        .locator('[data-testid="table-output"]')
        .inputValue();
      const records = JSON.parse(output);
      assertCsvToJsonRecords(records);
      await page.getByRole('button', { name: 'Download' }).click();
      const blob = await waitForBlob(page, 1, 10_000);
      if (!blob?.size || blob.type !== 'application/json') {
        throw new Error('CSV to JSON download did not deliver verified JSON.');
      }
      const downloadedOutput = await page.evaluate(() =>
        window.__lastBlob?.text(),
      );
      assertCsvToJsonRecords(JSON.parse(downloadedOutput));
      return {
        detail: 'verified 2 JSON records with preserved numeric cells',
        metrics: { outputBytes: blob.size, outputType: blob.type },
      };
    }

    if (tool.id === 'html-to-markdown') {
      await hookBlobCapture(page);
      const input = page.locator('[data-testid="html-input"]');
      const output = page.locator('[data-testid="markdown-output"]');
      await page.waitForFunction(
        () =>
          Boolean(
            document.querySelector('[data-testid="markdown-output"]')?.value,
          ),
        null,
        { timeout: 10000 },
      );
      await input.fill('<h1>stale</h1>');
      await page.getByRole('button', { name: 'Clear' }).click();
      await page.waitForTimeout(400);
      if ((await input.inputValue()) || (await output.inputValue())) {
        throw new Error('HTML clear allowed a scheduled result to reappear.');
      }

      await input.fill('<h1>Smoke</h1><p>Hello <strong>world</strong>.</p>');
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="markdown-output"]')
            ?.value.includes('# Smoke'),
        null,
        { timeout: 10000 },
      );
      const markdown = await output.inputValue();
      if (!markdown.includes('**world**')) {
        throw new Error('HTML conversion omitted expected Markdown semantics.');
      }
      const beforeCount = await page.evaluate(
        () => window.__blobEvents?.length ?? 0,
      );
      await page.getByRole('button', { name: 'Download .md' }).click();
      const blob = await waitForBlob(page, beforeCount + 1, 10000);
      return {
        detail: `markdown ${markdown.length} chars`,
        metrics: {
          outputBytes: blob?.size ?? null,
          outputType: blob?.type ?? null,
        },
      };
    }

    if (tool.id === 'csv-combiner') {
      const csvFixtures = toolFixtures['csv-combiner']?.fixtures ?? [];
      const csvPaths = csvFixtures.map(resolveFixturePath).filter(Boolean);
      if (csvPaths.length < 2) {
        return { skipped: true, reason: 'missing csv fixtures' };
      }
      await hookBlobCapture(page);
      await dropFilesOnDropzone(
        page,
        '[data-testid="csv-combiner-dropzone"]',
        csvPaths,
      );
      await page.waitForFunction(
        (names) =>
          names.every((name) => document.body.textContent?.includes(name)),
        csvPaths.map((csvPath) => path.basename(csvPath)),
        { timeout: 10000 },
      );
      await page.click('[data-testid="csv-combiner-run"]');
      await page.waitForFunction(
        () => document.body.textContent?.includes('4 rows · 4 columns'),
        null,
        { timeout: 10000 },
      );
      const beforeCount = await page.evaluate(
        () => window.__blobEvents?.length ?? 0,
      );
      await page.click('[data-testid="csv-combiner-download"]');
      const blob = await waitForBlob(page, beforeCount + 1, 10000);
      const output = await page.evaluate(() => window.__lastBlob?.text());
      const lines = output?.trim().split('\n') ?? [];
      const header = lines[0]?.split(',').map((value) => value.trim()) ?? [];
      const required = ['name', 'count', 'score', 'extra'];
      const missing = required.filter((item) => !header.includes(item));
      if (missing.length || lines.length !== 5) {
        throw new Error(
          `CSV combiner output did not preserve 4 rows and headers: ${missing.join(', ')}`,
        );
      }
      return {
        detail: `output ${lines.length} lines`,
        metrics: {
          outputBytes: blob?.size ?? null,
          outputType: blob?.type ?? null,
        },
      };
    }

    if (tool.id === 'character-counter') {
      const sampleText =
        toolFixtures['character-counter']?.fixtureText ??
        'Hello world.\n\nSecond line!';
      await page.fill('[data-testid="character-counter-input"]', 'stale value');
      await page.waitForTimeout(100);
      await page.fill('[data-testid="character-counter-input"]', sampleText);
      await page.waitForTimeout(100);
      const earlyWords = await page.textContent('[data-testid="stat-words"]');
      if (Number(earlyWords?.replace(/[^0-9]/g, '') || 0) !== 0) {
        throw new Error('Character debounce published stale statistics.');
      }
      await page.waitForFunction(
        (expected) =>
          Number(
            document
              .querySelector('[data-testid="stat-characters"]')
              ?.textContent?.replace(/[^0-9]/g, '') || 0,
          ) === expected,
        sampleText.length,
        { timeout: 10000 },
      );
      const grab = async (testId) => {
        const text = await page.textContent(`[data-testid=\"${testId}\"]`);
        return Number(text?.replace(/[^0-9]/g, '') || 0);
      };
      const stats = {
        characters: await grab('stat-characters'),
        charactersNoSpaces: await grab('stat-characters-no-spaces'),
        words: await grab('stat-words'),
        sentences: await grab('stat-sentences'),
        paragraphs: await grab('stat-paragraphs'),
        lines: await grab('stat-lines'),
        readingTime: await grab('stat-reading-time'),
        speakingTime: await grab('stat-speaking-time'),
      };
      const expected = {
        characters: sampleText.length,
        charactersNoSpaces: sampleText.replace(/\s/g, '').length,
        words: sampleText.trim().split(/\s+/).length,
        sentences: sampleText.split(/[.!?]+/).filter((s) => s.trim().length > 0)
          .length,
        paragraphs: sampleText.split(/\n\n+/).filter((p) => p.trim().length > 0)
          .length,
        lines: sampleText.split(/\n/).length,
        readingTime: Math.ceil(sampleText.trim().split(/\s+/).length / 200),
        speakingTime: Math.ceil(sampleText.trim().split(/\s+/).length / 150),
      };
      const mismatches = Object.entries(expected)
        .filter(([key, value]) => stats[key] !== value)
        .map(([key, value]) => `${key}=${stats[key]} (expected ${value})`);
      if (mismatches.length) {
        throw new Error(`Character counter mismatch: ${mismatches.join('; ')}`);
      }
      return {
        detail: `chars ${stats.characters}, words ${stats.words}`,
        metrics: stats,
      };
    }

    if (
      (tool.operation === 'view' || tool.operation === 'edit') &&
      tool.from === 'pdf' &&
      tool.to === 'pdf'
    ) {
      const fixtureEntry = getFormatFixture('pdf');
      if (!fixtureEntry) {
        return { skipped: true, reason: 'missing pdf fixture' };
      }
      await hookBlobCapture(page);
      await page
        .locator('[data-testid="pdf-tool-input"]')
        .setInputFiles(fixtureEntry.path);
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="pdf-tool-viewer"]')
            ?.getAttribute('src')
            ?.includes('file=blob%3A'),
        null,
        { timeout: 15000 },
      );
      const viewerUrl = await page
        .locator('[data-testid="pdf-tool-viewer"]')
        .getAttribute('src');
      const blob = await waitForBlob(page, 1, 10000);
      if (
        !viewerUrl?.includes('file=blob%3A') ||
        blob?.type !== 'application/pdf'
      ) {
        throw new Error(
          'PDF file did not reach the vendored viewer as a PDF blob.',
        );
      }

      const firstPageCanvas = page
        .frameLocator('[data-testid="pdf-tool-viewer"]')
        .locator('.page[data-page-number="1"] > .canvasWrapper > canvas');
      await firstPageCanvas.waitFor({ state: 'visible', timeout: 15000 });

      return {
        detail: 'verified PDF blob and rendered viewer page 1',
        metrics: {
          outputBytes: blob.size ?? null,
          outputType: blob.type ?? null,
          renderedPage: 1,
        },
      };
    }

    if (tool.id === 'audio-to-text' || tool.id === 'audio-to-transcript') {
      const toolFixture = toolFixtures[tool.id]?.fixture;
      const fixtureEntry = toolFixture
        ? { path: resolveFixturePath(toolFixture) }
        : getFormatFixture('mp3');
      if (!fixtureEntry) {
        return { skipped: true, reason: 'missing mp3 fixture' };
      }
      await dropFilesOnDropzone(page, '[data-testid="tool-dropzone"]', [
        fixtureEntry.path,
      ]);
      const terminalHandle = await page.waitForFunction(
        readTranscriptionTerminalState,
        undefined,
        { timeout: 60_000 },
      );
      const terminal = await terminalHandle.jsonValue();
      if (terminal.status === 'failed') {
        throw new Error(`Transcription failed: ${terminal.message}`);
      }
      return { detail: `transcript ${terminal.transcript.length} chars` };
    }

    if (tool.from) {
      const fixture = getFormatFixture(tool.from);
      if (!fixture) {
        return { skipped: true, reason: `missing fixture for ${tool.from}` };
      }
      await hookBlobCapture(page);
      await dropFilesOnDropzone(page, '[data-testid="tool-dropzone"]', [
        fixture.path,
      ]);
      await page.waitForSelector('[data-testid="video-progress"]', {
        timeout: 15000,
      });
      const initialProgress = await page.textContent(
        '[data-testid="video-progress"]',
      );
      const safeFailureMessage = 'This conversion is not currently supported';
      if (
        !initialProgress?.toLowerCase().includes('complete') &&
        !initialProgress?.includes(safeFailureMessage)
      ) {
        await page.waitForFunction(
          (expectedSafeFailure) => {
            const el = document.querySelector('[data-testid="video-progress"]');
            const text = el?.textContent ?? '';
            return (
              text.toLowerCase().includes('complete') ||
              text.includes(expectedSafeFailure)
            );
          },
          safeFailureMessage,
          { timeout: tool.requiresFFmpeg ? 60000 : 20000 },
        );
      }
      const terminalProgress = await page.textContent(
        '[data-testid="video-progress"]',
      );
      if (terminalProgress?.includes(safeFailureMessage)) {
        if (getGenericSmokeExpectation(tool) !== 'unsupported') {
          throw new Error(
            `A known supported adapter route reported unsupported (${GENERIC_SMOKE_CAPABILITY_VERSION}).`,
          );
        }
        return {
          detail: 'safe failure: published route is truthfully unsupported',
          metrics: { outputBytes: 0, outputType: null },
        };
      }
      const blob = await waitForBlob(
        page,
        1,
        tool.requiresFFmpeg ? 60000 : 20000,
      );
      if (!blob?.size) {
        throw new Error('Conversion did not produce output blob.');
      }
      const expectedType = getExpectedMimeType(tool.to);
      if (
        blob?.type &&
        expectedType !== 'application/octet-stream' &&
        blob.type !== expectedType
      ) {
        return {
          detail: `output ${blob?.size ?? '?'} (type ${blob?.type ?? '?'})`,
          metrics: {
            outputBytes: blob?.size ?? null,
            outputType: blob?.type ?? null,
          },
          warning: `unexpected output type ${blob?.type ?? '?'} (expected ${expectedType})`,
        };
      }
      return {
        detail: `output ${blob?.size ?? '?'}`,
        metrics: {
          outputBytes: blob?.size ?? null,
          outputType: blob?.type ?? null,
        },
      };
    }

    return { skipped: true, reason: 'no fixture mapping' };
  }

  async function runSmokeCheck(page, tool, result) {
    await page.waitForSelector('h1', { timeout: 10000 });
    await waitForHydration(page);
    await page.waitForTimeout(250);

    const functional = await runFunctionalTest(page, tool);
    if (functional?.skipped) {
      result.status = 'warn';
      result.errors.push(functional.reason);
    } else {
      result.detail = functional?.detail ?? null;
      result.metrics = functional?.metrics ?? null;
      if (functional?.warning) {
        if (result.status === 'pass') {
          result.status = 'warn';
        }
        result.errors.push(functional.warning);
      }
    }

    if (
      ['convert', 'compress', 'bulk', 'combine'].includes(tool.operation) &&
      !textOnlyTools.has(tool.id) &&
      tool.id !== 'csv-to-json'
    ) {
      const dropzone = await page.$(
        '[data-testid="tool-dropzone"], [data-testid="batch-compress-dropzone"], [data-testid="csv-combiner-dropzone"]',
      );
      if (!dropzone) {
        result.status = 'warn';
        result.errors.push('missing dropzone');
      }
    }
    const isSpecializedPdf =
      (tool.operation === 'view' || tool.operation === 'edit') &&
      tool.from === 'pdf' &&
      tool.to === 'pdf';
    if (
      (specializedSmokeTools.has(tool.id) || isSpecializedPdf) &&
      result.pageErrors.length > 0
    ) {
      throw new Error(
        `Rendered Tool raised ${result.pageErrors.length} pageerror event(s).`,
      );
    }
  }

  async function runBenchmark(page, _tool, result) {
    const navTiming = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      return nav?.domContentLoadedEventEnd || null;
    });
    if (!navTiming) {
      throw new Error('Navigation performance timing is unavailable.');
    }
    result.loadMs = Math.round(navTiming);
    result.metrics = { domContentLoadedMs: result.loadMs };
    result.detail = `DOM content loaded in ${result.loadMs} ms`;
  }

  const modeHandlers = Object.freeze({
    smoke: runSmokeCheck,
    benchmark: runBenchmark,
  });

  for (const tool of tools) {
    const result = {
      id: tool.id,
      route: tool.route,
      status: 'pass',
      loadMs: null,
      detail: null,
      metrics: null,
      fixture: null,
      errors: [],
      pageErrors: [],
      consoleWarnings: [],
    };

    const page = await browser.newPage();
    page.on('pageerror', (error) => result.pageErrors.push(error));
    page.on('console', (message) => {
      if (message.type() === 'warning') {
        result.consoleWarnings.push(message.text());
      }
    });

    const fixtureEntry = tool.from ? formatFixtures.get(tool.from) : null;
    result.fixture = fixtureEntry
      ? {
          format: tool.from,
          status: fixtureEntry.status,
          fixture: fixtureEntry.fixture ?? null,
        }
      : null;

    try {
      const response = await page.goto(`${baseUrl}${tool.route}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      if (!response || response.status() >= 400) {
        throw new Error(`HTTP ${response?.status() ?? 'no-response'}`);
      }

      await modeHandlers[options.mode](page, tool, result);
    } catch (err) {
      const message = err?.message || String(err);
      if (
        tool.requiresFFmpeg &&
        /video conversion not supported|sharedarraybuffer/i.test(message)
      ) {
        result.status = 'warn';
        result.errors.push(message);
      } else {
        result.status = 'fail';
        result.errors.push(message);
      }
    } finally {
      await page.close();
    }

    results.push(result);
    const statusLabel = result.status.toUpperCase();
    console.log(`${statusLabel} ${tool.id} (${tool.route})`);
  }

  await browser.close();
  browser = undefined;

  const summary = results.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      if (item.fixture?.status === 'missing') {
        acc.missingFixtures = (acc.missingFixtures || 0) + 1;
      }
      return acc;
    },
    { pass: 0, warn: 0, fail: 0, missingFixtures: 0 },
  );

  console.log(`\nBrowser ${options.mode} summary:`);
  console.log(summary);

  const completedAt = new Date();
  const evidenceStatus = summary.fail > 0 ? 'failure' : 'success';
  const evidenceSummary = {
    checksPassed: summary.pass,
    checksFailed: summary.fail,
    items: results.length,
  };
  if (selectedMode.handler === 'benchmark') {
    Object.assign(
      evidenceSummary,
      summarizeNavigationTimings(results.map((result) => result.loadMs)),
    );
  }
  const evidence = recordBrowserEvidence(
    evidenceStatus,
    evidenceSummary,
    completedAt,
  );
  console.log(`Structured artifact: ${evidence.runId}`);

  if (summary.fail > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  if (browser !== undefined) {
    await browser.close().catch(() => {});
  }
  try {
    const evidence = recordBrowserEvidence('failure', {
      checksPassed: results.filter((result) => result.status === 'pass').length,
      checksFailed: Math.max(
        1,
        results.filter((result) => result.status === 'fail').length,
      ),
      items: selectedItemCount,
    });
    console.error(`Structured failure artifact: ${evidence.runId}`);
  } catch {
    console.error('Structured browser failure artifact could not be recorded');
  }
  console.error(
    error instanceof Error ? error.message : 'Browser check failed',
  );
  process.exitCode = 1;
}
