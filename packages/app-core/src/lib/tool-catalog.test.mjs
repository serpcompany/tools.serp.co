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
        registryEntry({ pageContentProfile: 'implicit-runtime-claims' }),
      ]),
    /pageContentProfile must be a supported Catalog content profile/,
  );
  assert.throws(
    () =>
      createToolCatalog([
        registryEntry({ pageContentProfile: 'legacy-pdf-v1' }),
      ]),
    /legacy-pdf-v1 requires a content-free edit or view Tool/,
  );
  assert.throws(
    () =>
      createToolCatalog([
        registryEntry({ pageContentProfile: 'legacy-sections-v1' }),
      ]),
    /legacy-sections-v1 requires explicit Tool content/,
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
  assert.equal(
    catalog.getById('content-tool')?.content?.tool.id,
    'content-tool',
  );
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

test('catalog resolves specialized and fallback Tool page content', () => {
  const specialized = toolCatalog.getPageContent('audio-to-text');
  assert.ok(specialized);
  assert.deepEqual(
    {
      id: specialized.tool.id,
      route: specialized.tool.route,
      operation: specialized.tool.operation,
      title: specialized.tool.title,
    },
    {
      id: 'audio-to-text',
      route: '/audio-to-text',
      operation: 'convert',
      title: 'Audio to Text',
    },
  );
  assert.ok(specialized.howTo);
  assert.ok(specialized.infoArticle);

  const generic = toolCatalog.getPageContent('3g2-to-mp4');
  assert.ok(generic);
  assert.deepEqual(generic.tool, {
    id: '3g2-to-mp4',
    route: '/3g2-to-mp4',
    operation: 'convert',
    title: '3G2 to MP4',
    subtitle: 'Convert 3G2 files to MP4 format',
    from: '3g2',
    to: 'mp4',
    accept: '.3g2',
    requiresFFmpeg: true,
  });
  assert.equal(generic.aboutSection?.title, '3G2 to MP4 conversion');
  assert.equal(generic.faqs?.length, 3);
  assert.deepEqual(generic.howTo, {
    title: 'How to convert 3G2 to MP4',
    intro: 'Follow these steps to convert 3G2 to MP4 online.',
    steps: [
      'Upload your 3G2 file.',
      'We convert your file and prepare the MP4 output.',
      'Download the new MP4 file when the conversion completes.',
    ],
  });
  assert.equal(
    generic.aboutSection?.fromFormat.description,
    '3G2 is a common file format used for storing images. This tool converts 3G2 files directly in your browser.',
  );
  assert.equal(
    generic.faqs?.[1]?.answer,
    'Yes. Conversion runs locally in your browser, so your files never leave your device.',
  );
  assert.match(
    generic.infoArticle?.markdown ?? '',
    /Files are processed locally so your data stays on your device\./,
  );

  assert.equal(toolCatalog.getPageContent('aaf-to-mp4'), undefined);
  assert.throws(
    () => generic.faqs?.push({ question: 'x', answer: 'y' }),
    TypeError,
  );
});

test('catalog preserves downloader and PDF fallback page profiles', () => {
  const catalog = createToolCatalog([
    registryEntry({
      id: 'download-alpha-videos',
      name: 'Alpha Video Downloader',
      description: 'Download public Alpha videos',
      operation: 'download',
      route: '/download-alpha-videos',
      from: 'Alpha',
      to: 'video',
    }),
    registryEntry({
      id: 'pdf-editor',
      name: 'PDF Editor',
      description: 'Edit PDF files',
      operation: 'edit',
      route: '/pdf-editor',
      from: 'pdf',
      to: 'pdf',
    }),
  ]);

  const downloader = catalog.getPageContent('download-alpha-videos');
  assert.equal(downloader?.tool.from, 'Alpha link');
  assert.equal(downloader?.tool.to, 'Video file');
  assert.equal(downloader?.howTo?.title, 'How to download Alpha videos');
  assert.equal(downloader?.faqs?.length, 4);

  const pdf = catalog.getPageContent('pdf-editor');
  assert.equal(pdf?.tool.accept, '.pdf,application/pdf');
  assert.equal(pdf?.aboutSection?.title, 'About PDF files');
  assert.equal(pdf?.faqs?.[0]?.question, 'What edits are supported?');

  const legacyPdfCatalog = createToolCatalog([
    registryEntry({
      id: 'pdf-reader',
      name: 'PDF Reader',
      description: 'Read PDF files',
      operation: 'view',
      route: '/pdf-reader',
      from: 'pdf',
      to: 'pdf',
      pageContentProfile: 'legacy-pdf-v1',
    }),
  ]);
  const legacyPdf = legacyPdfCatalog.getPageContent('pdf-reader');
  assert.deepEqual(legacyPdf?.howTo, {
    title: 'How to view PDF files',
    intro: 'Follow these steps to view PDF files online.',
    steps: [
      'Upload your PDF file.',
      'Open and read your PDF file in the viewer.',
      'Use the page and zoom controls to navigate.',
      'Download a copy if you need it offline.',
    ],
  });
  assert.equal(legacyPdf?.faqs?.[0]?.question, 'Can I read multi-page PDFs?');
  assert.equal(
    legacyPdf?.faqs?.[1]?.answer,
    'No. Files are processed locally in your browser, so your PDFs stay on your device.',
  );
  assert.equal(
    legacyPdf?.aboutSection?.toFormat.description,
    'Your document stays in PDF format while you view or edit it.',
  );
});

test('legacy content strategies preserve compression, bulk, and combine copy', () => {
  assert.deepEqual(toolCatalog.getPageContent('compress-aac')?.howTo, {
    title: 'How to compress AAC to smaller AAC files',
    intro: 'Follow these steps to compress AAC files without losing quality.',
    steps: [
      'Upload your AAC file.',
      'We compress your file and prepare the AAC output.',
      'Download the new AAC file when the conversion completes.',
    ],
  });
  assert.deepEqual(toolCatalog.getPageContent('batch-compress-png')?.howTo, {
    title: 'How to compress PNG to smaller PNG files',
    intro: 'Follow these steps to compress PNG files without losing quality.',
    steps: [
      'Upload your PNG files.',
      'We process each file and prepare the PNG outputs.',
      'Download the results as a ZIP once processing completes.',
    ],
  });
  assert.deepEqual(toolCatalog.getPageContent('csv-combiner')?.howTo, {
    title: 'How to combine CSV into one CSV file',
    intro: 'Follow these steps to merge CSV files into one CSV file.',
    steps: [
      'Upload your CSV files.',
      'Arrange or confirm the file order before combining.',
      'Download the merged CSV file when the process finishes.',
    ],
  });
});

test('related Tool queries resolve catalog routes and exclude inactive Tools', () => {
  const catalog = createToolCatalog([
    registryEntry(),
    registryEntry({
      id: 'beta-to-alpha',
      name: 'Beta to Alpha',
      route: '/beta-to-alpha',
      from: 'beta',
      to: 'alpha',
    }),
    registryEntry({
      id: 'alpha-to-gamma',
      name: 'Alpha to Gamma',
      route: '/alpha-to-gamma',
      from: 'alpha',
      to: 'gamma',
    }),
    registryEntry({
      id: 'inactive-alpha',
      name: 'Inactive Alpha',
      route: '/inactive-alpha',
      from: 'alpha',
      to: 'delta',
      isActive: false,
    }),
  ]);

  assert.deepEqual(
    catalog.getRelatedItems({
      currentToolId: 'alpha-to-beta',
      currentRoute: '/alpha-to-beta/',
      currentFrom: 'alpha',
      currentTo: 'beta',
      relatedTools: [
        {
          toolId: 'beta-to-alpha',
          title: 'Curated reverse converter',
          description: 'Curated description',
        },
        {
          href: '/alpha-to-gamma/',
          title: 'Curated gamma converter',
        },
        {
          toolId: 'inactive-alpha',
          title: 'Do not publish',
        },
      ],
    }),
    [
      {
        kind: 'tool',
        id: 'beta-to-alpha',
        name: 'Curated reverse converter',
        description: 'Curated description',
        route: '/beta-to-alpha',
      },
      {
        kind: 'tool',
        id: 'alpha-to-gamma',
        name: 'Curated gamma converter',
        description: 'Convert Alpha files to Beta format',
        route: '/alpha-to-gamma',
      },
    ],
  );

  assert.deepEqual(
    catalog
      .getRelatedItems({
        currentToolId: 'alpha-to-beta',
        currentRoute: '/alpha-to-beta',
        currentFrom: 'alpha',
        currentTo: 'beta',
      })
      .map((tool) => tool.id),
    ['beta-to-alpha', 'alpha-to-gamma'],
  );
});

test('related external links remain links and never receive fabricated Tool ids', () => {
  const catalog = createToolCatalog([registryEntry()]);

  assert.deepEqual(
    catalog.getRelatedItems({
      currentToolId: 'alpha-to-beta',
      relatedTools: [
        {
          href: 'https://example.com/guide',
          title: 'Format guide',
          description: 'External reference',
        },
      ],
    }),
    [
      {
        kind: 'external',
        name: 'Format guide',
        description: 'External reference',
        route: 'https://example.com/guide',
      },
    ],
  );
});
