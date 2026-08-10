import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { toolCatalog } from '../../../packages/app-core/src/lib/tool-catalog.ts';
import {
  getTableConvertPages,
  getTableRendererToolIds,
} from './table-convert-pages.ts';
import { selectToolRenderer } from './tool-renderer.ts';

test('csv-to-markdown is catalog-backed and uses the table renderer', () => {
  const tool = toolCatalog.getById('csv-to-markdown');
  const content = toolCatalog.getPageContent('csv-to-markdown');
  const tableConvertEntry = getTableConvertPages().find(
    (entry) => entry.slug === 'csv-to-markdown',
  );
  const directoryEntry = toolCatalog.directoryEntries.find(
    (entry) => entry.id === 'csv-to-markdown',
  );

  assert.ok(tool);
  assert.ok(content);
  assert.deepEqual(tableConvertEntry, {
    slug: tool.id,
    from: tool.from,
    to: tool.to,
    title: content.tool.title,
  });
  assert.equal(tool.operation, 'convert');
  assert.equal(tool.route, '/csv-to-markdown');
  assert.equal(tool.isActive, true);
  assert.equal(selectToolRenderer(tool), 'table');

  assert.ok(directoryEntry);
  assert.equal(directoryEntry.href, tool.route);
  assert.equal(toolCatalog.getByRoute(tool.route)?.id, tool.id);
});

test('every table renderer route resolves active Catalog identity and formats', () => {
  const toolIds = getTableRendererToolIds();
  assert.ok(toolIds.length > 100);

  for (const toolId of toolIds) {
    const tool = toolCatalog.getById(toolId);
    assert.ok(tool?.isActive, toolId);
    assert.ok(tool.from, toolId);
    assert.ok(tool.to, toolId);
    assert.ok(toolCatalog.getPageContent(toolId), toolId);
    assert.equal(selectToolRenderer(tool), 'table', toolId);
    const routeSource = readFileSync(
      new URL(`../app/(convert)/${toolId}/page.tsx`, import.meta.url),
      'utf8',
    );
    assert.match(routeSource, new RegExp(`const toolId = '${toolId}'`));
    assert.match(routeSource, /TableConvertLanding toolId=\{toolId\}/);
  }
});

test('table Catalog content preserves the prior renderer-visible copy', () => {
  const content = toolCatalog.getPageContent('csv-to-sql');
  assert.ok(content);

  assert.equal(content.tool.title, 'Convert CSV to Insert SQL Online');
  assert.equal(
    content.tool.subtitle,
    'Paste or upload CSV data, preview the table, and export SQL instantly.',
  );
  assert.deepEqual(content.howTo, {
    title: 'How to convert CSV to SQL',
    intro: 'Follow these steps to convert CSV to SQL online.',
    steps: [
      'Paste or upload your CSV data.',
      'Review the table preview and make edits if needed.',
      'Copy or download the SQL output when it is ready.',
    ],
  });
  assert.equal(content.aboutSection?.title, 'CSV to SQL table conversion');
  assert.match(content.infoArticle?.markdown ?? '', /Local processing in your browser/);
  assert.deepEqual(
    content.faqs?.map((faq) => faq.question),
    [
      'How do I convert CSV to SQL?',
      'Can I edit the table before exporting?',
      'Does this run in the browser?',
    ],
  );
});

test('HTML to Markdown retains its dedicated sections without adding new ones', () => {
  const content = toolCatalog.getPageContent('html-to-markdown');
  const pageSource = readFileSync(
    new URL('../app/(convert)/html-to-markdown/page.tsx', import.meta.url),
    'utf8',
  );
  assert.ok(content);
  assert.equal(content.howTo?.title, 'How to convert HTML to Markdown');
  assert.match(content.infoArticle?.markdown ?? '', /html-to-markdown.*WebAssembly/);
  assert.equal(content.faqs?.length, 5);
  assert.equal(
    content.faqs?.[4]?.question,
    'What is the difference between this and the HTML Table to Markdown converter?',
  );
  assert.doesNotMatch(pageSource, /AboutFormatsSection|ChangelogSection/);
});
