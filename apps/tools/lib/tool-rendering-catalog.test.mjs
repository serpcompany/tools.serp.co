import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { toolCatalog } from '../../../packages/app-core/src/lib/tool-catalog.ts';
import { selectToolRenderer } from './tool-renderer.ts';

const migratedConsumers = [
  '../components/ToolPageRenderer.tsx',
  '../components/DownloaderPageRenderer.tsx',
  '../components/PdfToolPage.tsx',
  '../components/sections/RelatedItemsSection.tsx',
  '../app/(convert)/[tool]/page.tsx',
  '../app/audio-to-text/page.tsx',
  '../app/video-downloader/page.tsx',
  '../app/character-counter/page.tsx',
  '../app/csv-combiner/page.tsx',
  '../app/(compress)/(batch)/batch-compress-png/page.tsx',
  '../app/(convert)/json-to-csv/page.tsx',
  '../app/(convert)/html-to-markdown/page.tsx',
  '../components/table-convert/TableConvertLanding.tsx',
];

const consumerSources = migratedConsumers.map((path) => ({
  path,
  source: readFileSync(new URL(path, import.meta.url), 'utf8'),
}));
const sharedRouteSource = readFileSync(
  new URL('../app/(convert)/[tool]/page.tsx', import.meta.url),
  'utf8',
);
const genericRendererSource = readFileSync(
  new URL('../components/ToolPageRenderer.tsx', import.meta.url),
  'utf8',
);

test('representative Tool pages consume catalog-resolved content', () => {
  const specialized = toolCatalog.getPageContent('audio-to-text');
  const downloader = toolCatalog.getPageContent('video-downloader');
  const generic = toolCatalog.getPageContent('3g2-to-mp4');
  const document = toolCatalog.getPageContent('pdf-reader');

  assert.equal(specialized?.tool.title, 'Audio to Text');
  assert.equal(downloader?.tool.title, 'Video Downloader');
  assert.equal(generic?.tool.accept, '.3g2');
  assert.equal(document?.tool.accept, '.pdf,application/pdf');
  assert.ok(generic?.howTo);
  assert.ok(generic?.infoArticle);
});

test('renderer selection preserves specialized Tool roles', () => {
  assert.equal(selectToolRenderer(toolCatalog.getById('csv-to-sql')), 'table');
  assert.equal(
    selectToolRenderer(toolCatalog.getById('audio-to-text')),
    'transcription',
  );
  assert.equal(
    selectToolRenderer(toolCatalog.getById('json-to-csv')),
    'specialized',
  );
  assert.equal(
    selectToolRenderer(toolCatalog.getById('html-to-markdown')),
    'specialized',
  );
  assert.equal(selectToolRenderer(toolCatalog.getById('3g2-to-mp4')), 'generic');
  assert.equal(
    selectToolRenderer(toolCatalog.getById('video-downloader')),
    'downloader',
  );
  assert.equal(selectToolRenderer(toolCatalog.getById('pdf-reader')), 'pdf');
  assert.equal(
    selectToolRenderer(toolCatalog.getById('video-editor')),
    'placeholder',
  );
  assert.equal(selectToolRenderer(undefined), 'not-found');

  assert.match(sharedRouteSource, /selectToolRenderer/);
});

test('generic Tool rendering obtains related Tools from the catalog', () => {
  const content = toolCatalog.getPageContent('3g2-to-mp4');
  assert.ok(content);

  const related = toolCatalog.getRelatedItems({
    currentFrom: content.tool.from,
    currentTo: content.tool.to,
    currentRoute: content.tool.route,
    currentToolId: content.tool.id,
    relatedTools: content.relatedTools,
  });

  assert.ok(related.length > 0);
  assert.equal(
    related.some((tool) => tool.id === content.tool.id),
    false,
  );
  assert.ok(
    related.every(
      (tool) =>
        tool.kind === 'external' ||
        toolCatalog.getByRoute(tool.route)?.isActive,
    ),
  );
  assert.match(genericRendererSource, /toolCatalog\.getRelatedItems/);
});

test('migrated Tool renderers do not parse the raw registry or rebuild fallbacks', () => {
  for (const { path, source } of consumerSources) {
    assert.doesNotMatch(source, /data\/tools\.json/, path);
    assert.doesNotMatch(source, /tool-content/, path);
    assert.doesNotMatch(source, /tool-sections/, path);
  }
});
