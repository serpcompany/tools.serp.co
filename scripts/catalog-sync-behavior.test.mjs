import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { updateExtensions } from './fetch-store-assets.mjs';
import {
  firstVerifiedUrl,
  planDownloaderRegistrySync,
} from './lib/downloader-registry-sync.mjs';
import { synchronizeDownloaderRegistry } from './sync-downloader-landers-from-registry.mjs';

function temporaryFile(t, name, contents) {
  const root = mkdtempSync(path.join(tmpdir(), 'tools-serp-catalog-sync-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const filePath = path.join(root, name);
  writeFileSync(filePath, contents);
  return filePath;
}

test('extension check mode reports changes without writing', async (t) => {
  const original = `${JSON.stringify([
    {
      slug: 'fixture',
      chromeStoreUrl: 'https://chromewebstore.google.com/detail/fixture/id',
    },
  ])}\n`;
  const dataPath = temporaryFile(t, 'extensions.json', original);
  const fetchStoreHtml = async () =>
    '<img srcset="https://lh3.googleusercontent.com/icon=s120">';

  const checked = await updateExtensions({ dataPath, fetchStoreHtml });
  assert.equal(checked.changed, true);
  assert.equal(readFileSync(dataPath, 'utf8'), original);

  await updateExtensions({ dataPath, fetchStoreHtml, write: true });
  assert.match(readFileSync(dataPath, 'utf8'), /googleusercontent/);
});

test('extension unreachability retains existing catalog data', async (t) => {
  const original = `${JSON.stringify([
    {
      slug: 'fixture',
      chromeStoreUrl: 'https://chromewebstore.google.com/detail/fixture/id',
      icon: 'retained-icon',
    },
  ])}\n`;
  const dataPath = temporaryFile(t, 'extensions.json', original);

  const result = await updateExtensions({
    dataPath,
    write: true,
    fetchStoreHtml: async () => {
      throw new Error('temporarily unavailable');
    },
  });

  assert.equal(result.unreachable, 1);
  assert.equal(readFileSync(dataPath, 'utf8'), original);
});

test('confirmed extension removal is reported without deleting catalog data', async (t) => {
  const original = `${JSON.stringify([
    {
      slug: 'fixture',
      chromeStoreUrl: 'https://chromewebstore.google.com/detail/fixture/id',
      icon: 'retained-icon',
    },
  ])}\n`;
  const dataPath = temporaryFile(t, 'extensions.json', original);
  const removed = new Error('not found');
  removed.status = 404;

  const result = await updateExtensions({
    dataPath,
    write: true,
    fetchStoreHtml: async () => {
      throw removed;
    },
  });

  assert.equal(result.confirmedRemovals, 1);
  assert.equal(result.unreachable, 0);
  assert.equal(readFileSync(dataPath, 'utf8'), original);
});

test('unrecognizable extension response is transient and non-destructive', async (t) => {
  const original = `${JSON.stringify([
    {
      slug: 'fixture',
      chromeStoreUrl: 'https://chromewebstore.google.com/detail/fixture/id',
      icon: 'retained-icon',
    },
  ])}\n`;
  const dataPath = temporaryFile(t, 'extensions.json', original);

  const result = await updateExtensions({
    dataPath,
    write: true,
    fetchStoreHtml: async () => '<html>consent required</html>',
  });

  assert.equal(result.unreachable, 1);
  assert.equal(result.confirmedRemovals, 0);
  assert.equal(readFileSync(dataPath, 'utf8'), original);
});

test('downloader check and write depend only on the canonical Tool Catalog output', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'tools-serp-downloader-sync-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const toolsPath = path.join(root, 'packages/app-core/src/data/tools.json');
  const unrelatedPath = path.join(root, 'unrelated.txt');
  mkdirSync(path.dirname(toolsPath), { recursive: true });
  writeFileSync(toolsPath, '[]\n');
  writeFileSync(unrelatedPath, 'preserved\n');
  const registry = {
    overrides: {
      'serpapps/example-downloader': {
        app_name: 'Example Video Downloader',
        short_description: 'Download Example Videos',
      },
    },
  };

  const checked = await synchronizeDownloaderRegistry({
    registry,
    root,
    verifyUrl: async () => false,
  });
  assert.equal(checked.newTools.length, 1);
  assert.equal(readFileSync(toolsPath, 'utf8'), '[]\n');
  assert.equal('plannerRows' in checked, false);
  assert.equal('nextPlannerSource' in checked, false);

  await synchronizeDownloaderRegistry({
    registry,
    root,
    write: true,
    verifyUrl: async () => false,
  });
  assert.equal(JSON.parse(readFileSync(toolsPath, 'utf8')).length, 1);
  assert.equal(readFileSync(unrelatedPath, 'utf8'), 'preserved\n');

  await assert.rejects(
    synchronizeDownloaderRegistry({
      registry: { overrides: { invalid: null } },
      root,
    }),
    /invalid record/i,
  );
});

test('downloader links come from exact candidates that respond successfully', async (t) => {
  const server = http.createServer((request, response) => {
    response.statusCode = request.url === '/verified' ? 200 : 500;
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, resolve);
  });
  t.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, 'object');
  const origin = `http://127.0.0.1:${address.port}`;

  assert.equal(
    await firstVerifiedUrl([
      `${origin}/transient-failure`,
      `${origin}/verified`,
    ]),
    `${origin}/verified`,
  );
  assert.equal(await firstVerifiedUrl([`${origin}/transient-failure`]), '');
});

test('downloader deduplication retains bounded title and product URL aliases', async () => {
  const existingTool = {
    id: 'download-existing-videos',
    name: 'Existing Downloader',
    description: 'Existing downloader fixture',
    operation: 'download',
    route: '/download-existing-videos',
    from: 'Existing',
    to: 'mp4',
    isActive: true,
    content: {
      tool: { title: 'Presentation Alias' },
      productLinks: { serplyUrl: 'https://serp.ly/existing-alias' },
    },
  };
  const result = await planDownloaderRegistrySync({
    toolsSource: JSON.stringify([existingTool]),
    registry: {
      overrides: {
        'serpapps/title-alias-downloader': {
          app_name: 'Presentation Alias',
          short_description: 'Download a title alias',
        },
        'serpapps/url-alias-downloader': {
          app_name: 'Different Downloader',
          short_description: 'Download a URL alias',
          serply_link: 'https://serp.ly/existing-alias',
        },
      },
    },
    verifyUrl: async () => false,
  });

  assert.deepEqual(result.newTools, []);
});
