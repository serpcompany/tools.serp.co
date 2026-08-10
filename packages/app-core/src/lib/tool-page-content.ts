import type {
  CatalogPageContent,
  CatalogPageContentProfile,
  CatalogTool,
  CatalogToolContent,
  ToolOperation,
} from './tool-catalog.ts';

type PageContentSource = Pick<
  CatalogTool,
  | 'id'
  | 'name'
  | 'description'
  | 'operation'
  | 'route'
  | 'from'
  | 'to'
  | 'requiresFFmpeg'
  | 'pageContentProfile'
  | 'content'
>;

type PageLabels = {
  from: string;
  to: string;
};

type PageProfile = {
  action: string;
  howToTitle(labels: PageLabels): string;
  howToIntro(labels: PageLabels): string;
  steps(labels: PageLabels): readonly string[];
  articleTitle(labels: PageLabels): string;
  articleSummary(tool: PageContentSource, labels: PageLabels): string;
};

const conversionProfile: PageProfile = {
  action: 'convert',
  howToTitle: ({ from, to }) => `How to convert ${from} to ${to}`,
  howToIntro: ({ from, to }) =>
    `Follow the Tool interface to convert ${from} to ${to}.`,
  steps: ({ from, to }) => [
    `Choose a ${from} source.`,
    `Select ${to} as the intended output.`,
    'Start the conversion and review the result.',
  ],
  articleTitle: ({ from, to }) => `About ${from} to ${to} conversions`,
  articleSummary: (tool, { from, to }) =>
    `${tool.name} is cataloged for converting ${from} inputs to ${to} outputs.`,
};

const editorProfile = (medium: string): PageProfile => ({
  action: 'edit',
  howToTitle: ({ from }) => `How to edit ${from} files`,
  howToIntro: ({ from }) =>
    `Follow the current Tool interface to edit a ${from} file.`,
  steps: ({ from, to }) => [
    `Choose a ${from} source.`,
    `Use the available ${medium} controls.`,
    `Review the intended ${to} output.`,
  ],
  articleTitle: ({ from }) => `About editing ${from} files`,
  articleSummary: (tool, { from }) =>
    `${tool.name} is cataloged for editing ${from} files.`,
});

const operationProfiles: Record<ToolOperation, PageProfile> = {
  convert: conversionProfile,
  compress: {
    action: 'compress',
    howToTitle: ({ from }) => `How to compress ${from} files`,
    howToIntro: ({ from }) =>
      `Follow the current Tool interface to prepare a smaller ${from} file.`,
    steps: ({ from, to }) => [
      `Choose a ${from} source.`,
      'Select the available compression settings.',
      `Review the intended ${to} output.`,
    ],
    articleTitle: ({ from }) => `About ${from} compression`,
    articleSummary: (tool, { from }) =>
      `${tool.name} is cataloged for reducing the size of ${from} files.`,
  },
  combine: {
    action: 'combine',
    howToTitle: ({ from, to }) =>
      `How to combine ${from} into one ${to} file`,
    howToIntro: ({ from, to }) =>
      `Follow the current Tool interface to combine ${from} sources into a ${to} output.`,
    steps: ({ from, to }) => [
      `Choose the ${from} sources to combine.`,
      'Review their intended order.',
      `Prepare the combined ${to} output.`,
    ],
    articleTitle: ({ from }) => `About combining ${from} files`,
    articleSummary: (tool, { from, to }) =>
      `${tool.name} is cataloged for combining ${from} sources into a ${to} output.`,
  },
  bulk: {
    action: 'process in bulk',
    howToTitle: ({ from }) => `How to process ${from} files in bulk`,
    howToIntro: ({ from, to }) =>
      `Follow the current Tool interface to prepare multiple ${to} outputs from ${from} sources.`,
    steps: ({ from, to }) => [
      `Choose the ${from} sources.`,
      `Select ${to} as the intended output.`,
      'Review the batch before starting it.',
    ],
    articleTitle: ({ from, to }) => `About bulk ${from} to ${to} workflows`,
    articleSummary: (tool, { from, to }) =>
      `${tool.name} is cataloged for preparing multiple ${to} outputs from ${from} sources.`,
  },
  download: {
    action: 'download',
    howToTitle: ({ from }) => `How to download ${from} files`,
    howToIntro: ({ from }) =>
      `Follow the current Tool interface for a supported ${from} source.`,
    steps: ({ from }) => [
      `Provide a supported ${from} source.`,
      'Review any availability or access message.',
      'Save the result if the source is supported.',
    ],
    articleTitle: ({ from }) => `About ${from} downloads`,
    articleSummary: (tool, { from }) =>
      `${tool.name} is cataloged for downloading supported public ${from} sources.`,
  },
  edit: editorProfile('editing'),
  view: {
    action: 'view',
    howToTitle: ({ from }) => `How to view ${from} files`,
    howToIntro: ({ from }) =>
      `Follow the current Tool interface to view a ${from} file.`,
    steps: ({ from }) => [
      `Choose a ${from} source.`,
      'Open the source in the available viewer.',
      'Use the controls presented by the Tool.',
    ],
    articleTitle: ({ from }) => `About viewing ${from} files`,
    articleSummary: (tool, { from }) =>
      `${tool.name} is cataloged for viewing ${from} files.`,
  },
  'video-editor': editorProfile('video editing'),
  'image-editor': editorProfile('image editing'),
  'audio-editor': editorProfile('audio editing'),
};

function contentString(
  content: CatalogToolContent | null,
  field: keyof CatalogToolContent['tool'],
): string | null {
  const value = content?.tool[field];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function formatLabel(value: string | null): string {
  return value?.toUpperCase() ?? '';
}

function pageLabels(tool: PageContentSource): PageLabels {
  const from =
    formatLabel(tool.from ?? contentString(tool.content, 'from')) || 'FILES';
  const to =
    formatLabel(tool.to ?? contentString(tool.content, 'to')) || from;
  return { from, to };
}

function usesLegacyContentProfile(
  profile: CatalogPageContentProfile | null,
): boolean {
  return profile !== null;
}

function isLegacyCompressionTool(tool: PageContentSource): boolean {
  if (tool.operation === 'compress') return true;
  const haystack = `${tool.name} ${tool.description}`.toLowerCase();
  return haystack.includes('compress') || haystack.includes('optimiz');
}

type LegacyPageProfile = {
  howToTitle(labels: PageLabels): string;
  howToIntro(labels: PageLabels): string;
  steps(labels: PageLabels): readonly string[];
  articleTitle(labels: PageLabels): string;
  articleSummary(tool: PageContentSource, labels: PageLabels): string;
};

function legacyConversionProfile(verb: string): LegacyPageProfile {
  return {
    howToTitle: ({ from, to }) => `How to ${verb} ${from} to ${to}`,
    howToIntro: ({ from, to }) =>
      `Follow these steps to ${verb} ${from} to ${to} online.`,
    steps: ({ from, to }) => [
      `Upload your ${from} file.`,
      `We ${verb} your file and prepare the ${to} output.`,
      `Download the new ${to} file when the conversion completes.`,
    ],
    articleTitle: ({ from, to }) => `About ${from} to ${to} conversions`,
    articleSummary: (tool, { from, to }) =>
      `${tool.name} lets you ${verb} ${from} to ${to} directly in your browser. Files are processed locally so your data stays on your device.`,
  };
}

const legacyCompressionProfile: LegacyPageProfile = {
  howToTitle: ({ from, to }) =>
    from === to
      ? `How to compress ${from} to smaller ${to} files`
      : `How to compress ${from} to ${to}`,
  howToIntro: ({ from, to }) =>
    from === to
      ? `Follow these steps to compress ${from} files without losing quality.`
      : `Follow these steps to compress ${from} to ${to} online.`,
  steps: ({ from, to }) => [
    `Upload your ${from} file.`,
    `We compress your file and prepare the ${to} output.`,
    `Download the new ${to} file when the conversion completes.`,
  ],
  articleTitle: ({ from }) => `About ${from} compression`,
  articleSummary: (tool, { from }) =>
    `${tool.name} compresses ${from} files to reduce size while keeping quality intact.`,
};

const legacyBulkProfile: LegacyPageProfile = {
  ...legacyConversionProfile('batch convert'),
  steps: ({ from, to }) => [
    `Upload your ${from} files.`,
    `We process each file and prepare the ${to} outputs.`,
    'Download the results as a ZIP once processing completes.',
  ],
};
const legacyBulkCompressionProfile: LegacyPageProfile = {
  ...legacyCompressionProfile,
  howToTitle: ({ from, to }) =>
    from === to
      ? `How to compress ${from} to smaller ${to} files`
      : `How to batch compress ${from} to ${to}`,
  howToIntro: ({ from, to }) =>
    from === to
      ? `Follow these steps to compress ${from} files without losing quality.`
      : `Follow these steps to batch compress ${from} to ${to} online.`,
  steps: ({ from, to }) => [
    `Upload your ${from} files.`,
    `We process each file and prepare the ${to} outputs.`,
    'Download the results as a ZIP once processing completes.',
  ],
};

const legacyOperationProfiles: Record<ToolOperation, LegacyPageProfile> = {
  convert: legacyConversionProfile('convert'),
  compress: legacyCompressionProfile,
  combine: {
    howToTitle: ({ from, to }) =>
      `How to combine ${from} into one ${to} file`,
    howToIntro: ({ from, to }) =>
      `Follow these steps to merge ${from} files into one ${to} file.`,
    steps: ({ from, to }) => [
      `Upload your ${from} files.`,
      'Arrange or confirm the file order before combining.',
      `Download the merged ${to} file when the process finishes.`,
    ],
    articleTitle: ({ from }) => `About combining ${from} files`,
    articleSummary: (tool, { from, to }) =>
      `${tool.name} combines multiple ${from} files into a single ${to} file without installing extra software.`,
  },
  bulk: legacyBulkProfile,
  download: {
    howToTitle: ({ from }) => `How to download ${from} files`,
    howToIntro: ({ from }) =>
      `Follow these steps to download ${from} files to your device.`,
    steps: ({ from }) => [
      `Upload your ${from} file.`,
      'Start the download and wait for the file to finish.',
      'Save the file to your device.',
    ],
    articleTitle: ({ from }) => `About downloading ${from} files`,
    articleSummary: (tool, { from }) =>
      `${tool.name} helps you download ${from} files quickly and save them to your device.`,
  },
  edit: {
    howToTitle: ({ from }) => `How to edit ${from} files`,
    howToIntro: ({ from }) =>
      `Follow these steps to edit ${from} files online.`,
    steps: ({ from, to }) => [
      `Upload your ${from} file.`,
      `Make your edits inside the ${from} editor.`,
      'Use highlight, underline, text, or draw tools to add annotations.',
      `Download the updated ${to} file when finished.`,
    ],
    articleTitle: ({ from }) => `About editing ${from} files`,
    articleSummary: (tool, { from }) =>
      `${tool.name} lets you annotate and edit ${from} files, then download an updated copy without installing software.`,
  },
  view: {
    howToTitle: ({ from }) => `How to view ${from} files`,
    howToIntro: ({ from }) =>
      `Follow these steps to view ${from} files online.`,
    steps: ({ from }) => [
      `Upload your ${from} file.`,
      `Open and read your ${from} file in the viewer.`,
      'Use the page and zoom controls to navigate.',
      'Download a copy if you need it offline.',
    ],
    articleTitle: ({ from }) => `About viewing ${from} files`,
    articleSummary: (tool, { from }) =>
      `${tool.name} opens ${from} files in a fast viewer so you can read them instantly in the browser.`,
  },
  'video-editor': legacyConversionProfile('convert'),
  'image-editor': legacyConversionProfile('convert'),
  'audio-editor': legacyConversionProfile('convert'),
};

function legacyPageProfile(tool: PageContentSource): LegacyPageProfile {
  if (isLegacyCompressionTool(tool)) {
    return tool.operation === 'bulk'
      ? legacyBulkCompressionProfile
      : legacyCompressionProfile;
  }
  return legacyOperationProfiles[tool.operation];
}

function buildLegacyHowToSection(tool: PageContentSource) {
  const labels = pageLabels(tool);
  const profile = legacyPageProfile(tool);
  return {
    title: profile.howToTitle(labels),
    intro: profile.howToIntro(labels),
    steps: profile.steps(labels),
  };
}

function buildLegacyInfoArticleSection(tool: PageContentSource) {
  const labels = pageLabels(tool);
  const profile = legacyPageProfile(tool);

  return {
    title: profile.articleTitle(labels),
    markdown: [
      profile.articleSummary(tool, labels),
      `Use this tool when you need ${labels.to} files for compatibility, sharing, or smaller sizes. It works on modern desktop and mobile browsers without installing software.`,
      'For best results, start with clean source files. Larger files take longer to process, especially for video or audio conversions.',
      '**Why use this tool**',
      '- Runs in the browser with no uploads required.',
      '- Keeps your original file untouched.',
      '- Works on desktop and mobile devices.',
    ].join('\n\n'),
  };
}

function buildHowToSection(tool: PageContentSource) {
  if (usesLegacyContentProfile(tool.pageContentProfile)) {
    return buildLegacyHowToSection(tool);
  }
  const labels = pageLabels(tool);
  const profile = operationProfiles[tool.operation];
  return {
    title: profile.howToTitle(labels),
    intro: profile.howToIntro(labels),
    steps: profile.steps(labels),
  };
}

function buildInfoArticleSection(tool: PageContentSource) {
  if (usesLegacyContentProfile(tool.pageContentProfile)) {
    return buildLegacyInfoArticleSection(tool);
  }
  const labels = pageLabels(tool);
  const profile = operationProfiles[tool.operation];
  return {
    title: profile.articleTitle(labels),
    markdown: [
      profile.articleSummary(tool, labels),
      `The Catalog records this Tool's intent as “${profile.action}.” Exact processing location, supported limits, availability, and output behavior belong to the current implementation and its runtime evidence.`,
    ].join('\n\n'),
  };
}

function conversionFallback(tool: PageContentSource) {
  const { from: fromLabel, to: toLabel } = pageLabels(tool);
  const from = tool.from ?? '';
  const legacy = tool.pageContentProfile === 'legacy-conversion-v1';
  const acceptByFormat: Record<string, string> = {
    pdf: '.pdf',
    jpg: '.jpg,.jpeg',
    jpeg: '.jpeg,.jpg',
    tiff: '.tif,.tiff',
  };

  return {
    tool: {
      id: tool.id,
      route: tool.route,
      operation: tool.operation,
      title: tool.name,
      subtitle:
        tool.description ||
        `Convert ${fromLabel} files to ${toLabel} format${legacy ? ' in seconds' : ''}.`,
      from,
      to: tool.to ?? '',
      accept: acceptByFormat[from] ?? (from ? `.${from}` : undefined),
      requiresFFmpeg: tool.requiresFFmpeg,
    },
    aboutSection: {
      title: `${fromLabel} to ${toLabel} conversion`,
      fromFormat: {
        name: fromLabel,
        fullName: `${fromLabel} file`,
        description: legacy
          ? `${fromLabel} is a common file format used for storing images. This tool converts ${fromLabel} files directly in your browser.`
          : `${fromLabel} is the source format recorded for this Tool.`,
      },
      toFormat: {
        name: toLabel,
        fullName: `${toLabel} file`,
        description: legacy
          ? `${toLabel} is a widely supported image format that works across devices and platforms.`
          : `${toLabel} is the intended output format recorded for this Tool.`,
      },
    },
    faqs: [
      {
        question: legacy
          ? `How do I convert ${fromLabel} to ${toLabel}?`
          : `What does ${fromLabel} to ${toLabel} mean?`,
        answer: legacy
          ? 'Drop your file in the converter above and download the result once it finishes.'
          : `The Catalog identifies ${fromLabel} as the source format and ${toLabel} as the intended output format.`,
      },
      {
        question: legacy ? 'Is this conversion private?' : 'Which files are supported?',
        answer: legacy
          ? 'Yes. Conversion runs locally in your browser, so your files never leave your device.'
          : 'Supported inputs and limits are defined by the current Tool implementation. Review the controls and validation shown on the Tool page.',
      },
      {
        question: legacy ? 'Do I need to install anything?' : 'What output should I expect?',
        answer: legacy
          ? 'No. Everything runs in the browser—just upload and convert.'
          : `The intended output format is ${toLabel}. Current runtime behavior determines the exact result.`,
      },
    ],
  };
}

function downloaderFallback(tool: PageContentSource) {
  const sourceLabel =
    (tool.from ?? tool.name.replace(/ Video Downloader$/, '')) || 'video';
  const sourceTypeLabel =
    sourceLabel.toUpperCase() === 'M3U8'
      ? `${sourceLabel} playlist link`
      : `${sourceLabel} link`;

  return {
    tool: {
      id: tool.id,
      route: tool.route,
      operation: tool.operation,
      title: tool.name,
      subtitle:
        tool.description ||
        `Download videos from supported public ${sourceLabel} links.`,
      from: sourceTypeLabel,
      to: 'Video file',
    },
    howTo: {
      title: `How to download ${sourceLabel} videos`,
      intro: `Follow the current Tool interface for a supported public ${sourceLabel} source.`,
      steps: [
        `Provide a supported public ${sourceTypeLabel}.`,
        'Review any availability or access message.',
        'Save the result if the source is supported.',
      ],
    },
    infoArticle: buildInfoArticleSection({ ...tool, from: sourceTypeLabel }),
    faqs: [
      {
        question: `Which ${sourceLabel} links are intended?`,
        answer: `This Tool is cataloged for supported public ${sourceLabel} links. Current provider support is defined by the implementation.`,
      },
      {
        question: 'What output is intended?',
        answer:
          'The Catalog records a downloadable video file as the intended output. The source and runtime determine the exact container.',
      },
      {
        question: 'What restrictions apply?',
        answer:
          'Availability, access rules, and limits belong to the current provider integration and runtime evidence.',
      },
      {
        question: `Why might a ${sourceLabel} link fail?`,
        answer:
          'The source may be unsupported, restricted, expired, or temporarily unavailable. Use the current Tool error for the specific run.',
      },
    ],
    aboutSection: {
      title: `${sourceLabel} video download`,
      fromFormat: {
        name: sourceTypeLabel,
        fullName: `Public ${sourceTypeLabel}`,
        description: `A public ${sourceLabel} source is the Catalog intent for this Tool.`,
      },
      toFormat: {
        name: 'Video file',
        fullName: 'Downloadable video file',
        description: 'A video file is the intended Catalog output.',
      },
    },
  };
}

function pdfFallback(tool: PageContentSource) {
  const editing = tool.operation === 'edit';
  const legacy = tool.pageContentProfile === 'legacy-pdf-v1';
  return {
    tool: {
      id: tool.id,
      route: tool.route,
      operation: tool.operation,
      title: tool.name,
      subtitle:
        tool.description ||
        (legacy
          ? 'Open and manage PDF documents directly in your browser.'
          : 'Open and manage PDF documents.'),
      from: tool.from ?? 'pdf',
      to: tool.to ?? 'pdf',
      accept: '.pdf,application/pdf',
      requiresFFmpeg: tool.requiresFFmpeg,
    },
    howTo: buildHowToSection(tool),
    infoArticle: buildInfoArticleSection(tool),
    faqs: editing
      ? [
          {
            question: 'What edits are supported?',
            answer:
              legacy
                ? 'Use the built-in toolbar to highlight, draw, add text or shapes, and export an updated PDF.'
                : 'Editing capabilities are defined by the current Tool implementation. Review the controls shown on the Tool page.',
          },
          {
            question: legacy
              ? 'Are my PDFs uploaded anywhere?'
              : 'What file format is intended?',
            answer: legacy
              ? 'No. Files are processed locally in your browser, so your PDFs stay on your device.'
              : 'The Catalog records PDF as both the input and output format.',
          },
          {
            question: legacy
              ? 'Can I keep the original PDF?'
              : 'What happens to the original?',
            answer:
              legacy
                ? 'Yes. The original file stays unchanged and you download a new edited copy.'
                : 'The current implementation and runtime evidence define file handling behavior.',
          },
        ]
      : [
          {
            question: legacy
              ? 'Can I read multi-page PDFs?'
              : 'Can this Tool view multi-page PDFs?',
            answer:
              legacy
                ? 'Yes. Use the viewer toolbar and thumbnails to move through your document.'
                : 'Viewer capabilities are defined by the current Tool implementation.',
          },
          {
            question: legacy
              ? 'Are my PDFs uploaded anywhere?'
              : 'What file format is intended?',
            answer: legacy
              ? 'No. Files are processed locally in your browser, so your PDFs stay on your device.'
              : 'The Catalog records PDF as the supported document intent.',
          },
          {
            question: legacy
              ? 'Does this work on mobile?'
              : 'Which viewer controls are available?',
            answer: legacy
              ? 'Yes. The viewer works on modern mobile browsers with touch-friendly controls.'
              : 'Use the controls presented by the current Tool interface.',
          },
        ],
    aboutSection: {
      title: 'About PDF files',
      fromFormat: {
        name: 'PDF',
        fullName: 'Portable Document Format',
        description:
          legacy
            ? 'PDFs preserve layout and formatting across devices and platforms.'
            : 'PDF is a document format designed to preserve layout and formatting.',
      },
      toFormat: {
        name: 'PDF',
        fullName: 'Portable Document Format',
        description: legacy
          ? 'Your document stays in PDF format while you view or edit it.'
          : 'PDF is the intended format for this Tool profile.',
      },
    },
  };
}

const fallbackBuilders: Partial<
  Record<ToolOperation, (tool: PageContentSource) => Record<string, unknown>>
> = {
  download: downloaderFallback,
  edit: pdfFallback,
  view: pdfFallback,
};

export function buildPageContent(
  tool: PageContentSource,
): CatalogPageContent {
  if (tool.content) {
    return {
      ...tool.content,
      tool: {
        ...tool.content.tool,
        id: tool.id,
        route: tool.route,
        operation: tool.operation,
        ...(tool.requiresFFmpeg ? { requiresFFmpeg: true } : {}),
      },
      howTo: tool.content.howTo ?? buildHowToSection(tool),
      infoArticle: tool.content.infoArticle ?? buildInfoArticleSection(tool),
    } as CatalogPageContent;
  }

  const buildFallback = fallbackBuilders[tool.operation] ?? conversionFallback;
  const content: Record<string, unknown> = buildFallback(tool);
  return {
    ...content,
    howTo: content['howTo'] ?? buildHowToSection(tool),
    infoArticle: content['infoArticle'] ?? buildInfoArticleSection(tool),
  } as CatalogPageContent;
}
