import { toolCatalog } from '@serp-tools/app-core/lib/tool-catalog';

import { selectToolRenderer } from './tool-renderer.ts';

export type ToolJourneyRuntimePath =
  | 'upload'
  | 'direct-url'
  | 'youtube-extractor'
  | 'other';

export type ToolJourneyInputKind =
  | 'file'
  | 'multiple-files'
  | 'text'
  | 'direct-url'
  | 'extractor-url'
  | 'local-editor'
  | 'unknown';

export type ToolJourney = Readonly<{
  id: string;
  toolId: string;
  input: Readonly<{
    kind: ToolJourneyInputKind;
    runtimePath: ToolJourneyRuntimePath;
  }>;
  promisedOutcome: string;
  requiredEnvironment: 'browser' | 'preview' | 'unknown';
  fixture: Readonly<{
    kind:
      | 'format-fixture'
      | 'tool-fixture'
      | 'direct-url-fixture'
      | 'maintainer-url'
      | 'literal'
      | 'unknown';
    reference: string | null;
    sourceNeeded?: string;
  }>;
  semanticInvariant: Readonly<{
    id: string | null;
    sourceNeeded: string | null;
  }>;
}>;

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

type CatalogTool = (typeof toolCatalog.activeTools)[number];

function transcriptionJourneys(tool: CatalogTool): readonly ToolJourney[] {
  const common = {
    toolId: tool.id,
    promisedOutcome:
      'Produce non-empty transcript text from the supplied media.',
    semanticInvariant: {
      id: 'non-empty-transcript',
      sourceNeeded: null,
    },
  };

  return deepFreeze([
    {
      ...common,
      id: `${tool.id}:upload`,
      input: { kind: 'file', runtimePath: 'upload' },
      requiredEnvironment: 'browser',
      fixture: {
        kind: 'tool-fixture',
        reference: 'fixtures/transcription-speech.mp3',
      },
    },
    {
      ...common,
      id: `${tool.id}:direct-url`,
      input: { kind: 'direct-url', runtimePath: 'direct-url' },
      requiredEnvironment: 'preview',
      fixture: {
        kind: 'direct-url-fixture',
        reference: 'fixtures/transcription-speech.mp3',
      },
    },
    {
      ...common,
      id: `${tool.id}:extractor-url`,
      input: { kind: 'extractor-url', runtimePath: 'youtube-extractor' },
      promisedOutcome:
        'Fail closed with a plain unsupported explanation and no delivery.',
      requiredEnvironment: 'preview',
      fixture: {
        kind: 'maintainer-url',
        reference: 'https://www.youtube.com/watch?v=3Is2P90qVa0',
      },
      semanticInvariant: {
        id: 'truthful-unsupported-terminal',
        sourceNeeded: null,
      },
    },
  ]);
}

function journey(
  tool: CatalogTool,
  name: string,
  input: ToolJourney['input'],
  promisedOutcome: string,
  requiredEnvironment: ToolJourney['requiredEnvironment'],
  fixture: ToolJourney['fixture'],
  invariantId: string | null,
  invariantSourceNeeded: string | null = null,
): ToolJourney {
  return deepFreeze({
    id: `${tool.id}:${name}`,
    toolId: tool.id,
    input,
    promisedOutcome,
    requiredEnvironment,
    fixture,
    semanticInvariant: {
      id: invariantId,
      sourceNeeded: invariantSourceNeeded,
    },
  });
}

function fileJourney(
  tool: CatalogTool,
  invariantId: string,
  inputKind: 'file' | 'multiple-files' = 'file',
): ToolJourney {
  const exactInvariantByToolId: Readonly<Record<string, string>> = {
    'compress-svg': 'inert-svg-render-equivalence',
    'png-to-webp': 'generic-file-exact-output',
    'bmp-to-jpeg': 'bmp-decoded-content-semantics',
    'bmp-to-jpg': 'bmp-decoded-content-semantics',
    'bmp-to-pdf': 'bmp-pdf-page-image-semantics',
    'bmp-to-png': 'bmp-decoded-content-semantics',
    'bmp-to-webp': 'bmp-decoded-content-semantics',
    'ico-to-png': 'ico-selected-image-pixel-semantics',
  };
  return journey(
    tool,
    inputKind === 'file' ? 'upload' : 'multiple-file-upload',
    { kind: inputKind, runtimePath: 'upload' },
    tool.to
      ? `Produce semantically valid ${tool.to} output for the ${tool.operation} operation.`
      : `Produce the Tool's declared ${tool.operation} result.`,
    'browser',
    {
      kind: inputKind === 'file' ? 'format-fixture' : 'tool-fixture',
      reference:
        inputKind === 'file' && tool.from
          ? `formats/${tool.from.toLowerCase()}`
          : `tools/${tool.id}`,
    },
    exactInvariantByToolId[tool.id] ?? invariantId,
  );
}

function specializedJourneys(tool: CatalogTool): readonly ToolJourney[] {
  if (tool.id === 'csv-combiner') {
    return deepFreeze([
      fileJourney(tool, 'combined-table-semantics', 'multiple-files'),
    ]);
  }
  return deepFreeze([
    journey(
      tool,
      'text-entry',
      { kind: 'text', runtimePath: 'other' },
      `Produce the Tool's declared ${tool.operation} result from entered text.`,
      'browser',
      { kind: 'literal', reference: `tools/${tool.id}` },
      'specialized-output-semantics',
    ),
  ]);
}

function downloaderJourneys(tool: CatalogTool): readonly ToolJourney[] {
  const common = {
    promisedOutcome:
      'Deliver semantically valid media bytes resolved from the supplied URL.',
    requiredEnvironment: 'preview' as const,
    invariantId: 'url-stream-exact-output',
  };
  return deepFreeze([
    journey(
      tool,
      'direct-url',
      { kind: 'direct-url', runtimePath: 'direct-url' },
      common.promisedOutcome,
      common.requiredEnvironment,
      { kind: 'direct-url-fixture', reference: 'tools/video-downloader' },
      common.invariantId,
    ),
    journey(
      tool,
      'extractor-url',
      { kind: 'extractor-url', runtimePath: 'youtube-extractor' },
      common.promisedOutcome,
      common.requiredEnvironment,
      {
        kind: 'unknown',
        reference: null,
        sourceNeeded: `A maintainer-controlled public URL fixture for ${tool.id}.`,
      },
      common.invariantId,
    ),
  ]);
}

function buildJourneys(tool: CatalogTool): readonly ToolJourney[] {
  const renderer = selectToolRenderer(tool);
  if (renderer === 'transcription') return transcriptionJourneys(tool);
  if (renderer === 'downloader') return downloaderJourneys(tool);
  if (renderer === 'specialized') return specializedJourneys(tool);
  if (renderer === 'pdf') {
    return deepFreeze([fileJourney(tool, 'specialized-output-semantics')]);
  }
  if (renderer === 'table') {
    return deepFreeze([fileJourney(tool, 'table-row-header-value-semantics')]);
  }
  if (renderer === 'generic') {
    return deepFreeze([
      fileJourney(
        tool,
        tool.operation === 'compress'
          ? 'compressed-file-semantics'
          : 'converted-file-semantics',
      ),
    ]);
  }
  if (tool.id === 'batch-compress-png') {
    return deepFreeze([
      fileJourney(tool, 'batch-archive-semantics', 'multiple-files'),
    ]);
  }
  return deepFreeze([
    journey(
      tool,
      'unknown',
      { kind: 'unknown', runtimePath: 'other' },
      `Resolve the user-visible outcome for ${tool.id}.`,
      'unknown',
      {
        kind: 'unknown',
        reference: null,
        sourceNeeded: 'Trace the active renderer to its user input seam.',
      },
      null,
      'Trace the active renderer to the semantic outcome it promises.',
    ),
  ]);
}

const tools = deepFreeze(
  toolCatalog.activeTools.map((tool) => ({
    toolId: tool.id,
    journeys: buildJourneys(tool),
  })),
);
const byToolId = new Map(tools.map((entry) => [entry.toolId, entry.journeys]));
const all = deepFreeze(tools.flatMap((entry) => entry.journeys));

if (byToolId.size !== toolCatalog.activeTools.length) {
  throw new TypeError('Tool Journey projection contains duplicate Tool ids.');
}
if (new Set(all.map((item) => item.id)).size !== all.length) {
  throw new TypeError(
    'Tool Journey projection contains duplicate journey ids.',
  );
}

function extractorHost(hostname: string) {
  const host = hostname.toLowerCase();
  return (
    host === 'youtu.be' ||
    host === 'youtube.com' ||
    host.endsWith('.youtube.com') ||
    host === 'youtube-nocookie.com' ||
    host.endsWith('.youtube-nocookie.com') ||
    host === 'tube8.com' ||
    host.endsWith('.tube8.com')
  );
}

type JourneyInput =
  | Readonly<{ kind: 'file' | 'files' | 'batch' | 'interaction' }>
  | Readonly<{ kind: 'url'; url: string }>
  | Readonly<{ kind: string }>;

function resolveInputKind(input: JourneyInput): ToolJourneyInputKind | null {
  if (input.kind === 'file') return 'file';
  if (input.kind === 'files' || input.kind === 'batch') return 'multiple-files';
  if (input.kind === 'interaction') return 'text';
  if (input.kind !== 'url' || !('url' in input)) return null;
  try {
    return extractorHost(new URL(input.url).hostname)
      ? 'extractor-url'
      : 'direct-url';
  } catch {
    return null;
  }
}

export const toolJourneys = Object.freeze({
  tools,
  all,
  getByToolId(toolId: string): readonly ToolJourney[] {
    return byToolId.get(toolId) ?? Object.freeze([]);
  },
  resolveInput(toolId: string, input: JourneyInput): ToolJourney | null {
    const inputKind = resolveInputKind(input);
    if (!inputKind) return null;
    return (
      byToolId.get(toolId)?.find((item) => item.input.kind === inputKind) ??
      null
    );
  },
  getBrowserTargets(toolId: string): readonly ToolJourney[] {
    const journeys = byToolId.get(toolId) ?? [];
    if (toolId === 'audio-to-text') {
      return deepFreeze(
        journeys.filter((item) =>
          new Set(['file', 'extractor-url']).has(item.input.kind),
        ),
      );
    }
    if (toolId === 'audio-to-transcript') {
      return deepFreeze(
        journeys.filter((item) => item.input.kind === 'direct-url'),
      );
    }
    if (selectToolRenderer(toolCatalog.getById(toolId)) === 'transcription') {
      return Object.freeze([]);
    }
    if (selectToolRenderer(toolCatalog.getById(toolId)) === 'downloader') {
      return deepFreeze(
        journeys.filter((item) => item.input.kind === 'direct-url'),
      );
    }
    return journeys[0] ? deepFreeze([journeys[0]]) : Object.freeze([]);
  },
});
