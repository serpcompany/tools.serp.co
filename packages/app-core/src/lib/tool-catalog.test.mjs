import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TOOL_OPERATION_TAXONOMY,
  createToolCatalog,
  toolCatalog,
} from './tool-catalog.ts';

function registryEntry(overrides = {}) {
  return {
    id: 'alpha-to-beta',
    name: 'Alpha to Beta',
    description: 'Convert Alpha files to Beta format',
    operation: 'convert',
    route: '/alpha-to-beta',
    from: 'alpha',
    to: 'beta',
    isActive: true,
    tags: ['alpha', 'beta'],
    ...overrides,
  };
}

test('catalog validates registry identity, routes, operations, and optional fields', () => {
  assert.throws(() => createToolCatalog({}), /registry must be an array/);
  assert.throws(
    () => createToolCatalog([registryEntry({ id: '' })]),
    /\[0\]\.id must be a non-empty string/,
  );
  assert.throws(
    () => createToolCatalog([registryEntry({ operation: 'verified' })]),
    /\[0\]\.operation must be a supported Tool operation/,
  );
  assert.throws(
    () => createToolCatalog([registryEntry({ route: 'alpha-to-beta' })]),
    /\[0\]\.route must be a canonical absolute route/,
  );
  assert.throws(
    () => createToolCatalog([registryEntry({ tags: ['alpha', 42] })]),
    /\[0\]\.tags must contain only strings/,
  );
  assert.throws(
    () => createToolCatalog([registryEntry({ health: 'passing' })]),
    /\[0\] has unsupported field: health/,
  );
  assert.throws(
    () =>
      createToolCatalog([
        registryEntry({
          content: {
            tool: {
              title: 'Alpha to Beta',
              subtitle: 'Convert Alpha files',
              from: 'alpha',
              to: 'beta',
            },
            faqs: 'not-an-array',
          },
        }),
      ]),
    /content\.faqs must be an array/,
  );
  assert.throws(
    () =>
      createToolCatalog([
        registryEntry({
          content: {
            tool: {
              title: 'Alpha to Beta',
              subtitle: 'Convert Alpha files',
              from: 'alpha',
              to: 'beta',
            },
            howTo: { title: 'How to convert', steps: [42] },
          },
        }),
      ]),
    /content\.howTo\.steps must contain only strings/,
  );
  assert.throws(
    () =>
      createToolCatalog([
        registryEntry({
          content: {
            tool: {
              title: 'Alpha to Beta',
              subtitle: 'Convert Alpha files',
              from: 'alpha',
              to: 'beta',
            },
            productLinks: { serplyUrl: 7 },
          },
        }),
      ]),
    /content\.productLinks\.serplyUrl must be a non-empty string/,
  );
  assert.throws(
    () =>
      createToolCatalog([
        registryEntry(),
        registryEntry({ id: 'another-tool', route: '/alpha-to-beta/' }),
      ]),
    /duplicate normalized route/,
  );
  assert.throws(
    () =>
      createToolCatalog([
        registryEntry(),
        registryEntry({ route: '/another-tool' }),
      ]),
    /duplicate Tool id/,
  );
});

test('catalog content and taxonomy are detached and deeply read-only', () => {
  const source = registryEntry({
    content: {
      tool: {
        title: 'Alpha to Beta',
        subtitle: 'Convert Alpha files',
        from: 'alpha',
        to: 'beta',
      },
      howTo: {
        title: 'How to convert',
        steps: ['Choose a file'],
      },
    },
  });
  const catalog = createToolCatalog([source]);
  const content = catalog.getById('alpha-to-beta')?.content;

  assert.ok(content?.howTo);
  assert.notEqual(content, source.content);
  assert.throws(
    () => content.howTo.steps.push('Mutate shared state'),
    TypeError,
  );
  assert.deepEqual(source.content.howTo.steps, ['Choose a file']);
  assert.throws(() => {
    TOOL_OPERATION_TAXONOMY.convert.title = 'Mutated taxonomy';
  }, TypeError);
});

test('catalog exposes explicit missing facts and registry-backed display fallbacks', () => {
  const catalog = createToolCatalog([
    registryEntry({
      from: undefined,
      to: undefined,
      tags: undefined,
      keywords: undefined,
      priority: undefined,
      content: undefined,
    }),
    registryEntry({
      id: 'content-tool',
      route: '/content-tool',
      content: {
        tool: {
          id: 'content-tool',
          route: '/content-tool',
          operation: 'convert',
          title: 'Content title',
          subtitle: 'Content subtitle',
          from: 'source',
          to: 'target',
          requiresFFmpeg: true,
        },
      },
    }),
  ]);

  const fallback = catalog.getById('alpha-to-beta');
  assert.ok(fallback);
  assert.equal(fallback.from, null);
  assert.equal(fallback.to, null);
  assert.equal(fallback.priority, null);
  assert.equal(fallback.content, null);
  assert.deepEqual(fallback.tags, []);
  assert.deepEqual(fallback.keywords, []);
  assert.deepEqual(fallback.display, {
    title: 'Alpha to Beta',
    description: 'Convert Alpha files to Beta format',
    from: null,
    to: null,
  });

  assert.deepEqual(catalog.getById('content-tool')?.display, {
    title: 'Content title',
    description: 'Content subtitle',
    from: 'alpha',
    to: 'beta',
  });
  assert.equal(catalog.getById('content-tool')?.content?.tool.id, 'content-tool');
  assert.equal(
    catalog.getById('content-tool')?.content?.tool.requiresFFmpeg,
    true,
  );
  assert.equal('status' in fallback, false);
  assert.equal('verified' in fallback, false);
});

test('catalog owns active, route, operation, directory, and taxonomy indexes', () => {
  const catalog = createToolCatalog([
    registryEntry(),
    registryEntry({
      id: 'inactive-download',
      name: 'Inactive download',
      operation: 'download',
      route: '/inactive-download',
      isActive: false,
    }),
    registryEntry({
      id: 'active-download',
      name: 'Active download',
      operation: 'download',
      route: '/active-download',
      tags: ['download'],
    }),
    registryEntry({
      id: 'compress-alpha',
      name: 'Compress Alpha',
      operation: 'compress',
      route: '/compress-alpha',
    }),
  ]);

  assert.equal(catalog.getByRoute('/alpha-to-beta/')?.id, 'alpha-to-beta');
  assert.deepEqual(
    catalog.activeTools.map((tool) => tool.id),
    ['alpha-to-beta', 'active-download', 'compress-alpha'],
  );
  assert.deepEqual(
    catalog.getToolsByOperation('download').map((tool) => tool.id),
    ['inactive-download', 'active-download'],
  );
  assert.deepEqual(catalog.availableOperations, [
    'convert',
    'download',
    'compress',
  ]);
  assert.deepEqual(
    catalog.directoryCategories.map(({ id, count }) => ({ id, count })),
    [
      { id: 'convert', count: 1 },
      { id: 'download', count: 1 },
      { id: 'compress', count: 1 },
    ],
  );
  assert.deepEqual(
    catalog.getDirectoryTools('download').map((tool) => tool.id),
    ['active-download'],
  );
  assert.equal(catalog.directoryEntries[0]?.href, '/alpha-to-beta');
  assert.doesNotThrow(() => JSON.stringify(catalog.directoryCategories));
  assert.doesNotThrow(() => JSON.stringify(catalog.directoryEntries));
});

test('versioned registry builds the shared catalog used by public discovery', () => {
  assert.ok(toolCatalog.tools.length > 2_000);
  assert.ok(toolCatalog.activeTools.length > 2_000);
  assert.equal(
    toolCatalog.getById('csv-to-markdown')?.route,
    '/csv-to-markdown',
  );
  assert.equal(
    toolCatalog.getByRoute('/csv-to-markdown/')?.id,
    'csv-to-markdown',
  );
  assert.deepEqual(toolCatalog.availableOperations, [
    'convert',
    'download',
    'compress',
    'combine',
    'bulk',
    'edit',
    'video-editor',
    'image-editor',
    'audio-editor',
    'view',
  ]);
});
