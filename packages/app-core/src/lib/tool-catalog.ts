import registryData from '../data/tools.json' with { type: 'json' };
import { buildPageContent } from './tool-page-content.ts';

export const TOOL_OPERATION_ORDER = [
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
] as const;

export type ToolOperation = (typeof TOOL_OPERATION_ORDER)[number];

export const CATALOG_PAGE_CONTENT_PROFILES = [
  'legacy-conversion-v1',
  'legacy-pdf-v1',
  'legacy-sections-v1',
] as const;

export type CatalogPageContentProfile =
  (typeof CATALOG_PAGE_CONTENT_PROFILES)[number];

export type DeepReadonly<T> = T extends (
  ...args: infer Arguments
) => infer ReturnValue
  ? (...args: Arguments) => ReturnValue
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

type OperationTaxonomy = {
  name: string;
  title: string;
  description: string;
};

export const TOOL_OPERATION_TAXONOMY: DeepReadonly<
  Record<ToolOperation, OperationTaxonomy>
> = deepFreezeClone({
  bulk: {
    name: 'Bulk Operations',
    title: 'Bulk Operations',
    description:
      'Run batch file workflows and multi-file operations in a single pass.',
  },
  combine: {
    name: 'Combine',
    title: 'Combine Tools',
    description:
      'Merge multiple files into one output without installing extra software.',
  },
  compress: {
    name: 'Compress',
    title: 'Compress Tools',
    description:
      'Reduce file size online while keeping the output usable and shareable.',
  },
  convert: {
    name: 'Convert',
    title: 'Convert Tools',
    description:
      'Convert image, audio, video, document, and data files directly in your browser.',
  },
  download: {
    name: 'Downloaders',
    title: 'Downloaders',
    description:
      'Download supported public videos and media links straight to your device.',
  },
  edit: {
    name: 'Edit',
    title: 'Edit Tools',
    description:
      'Open and edit supported files online without installing desktop software.',
  },
  'video-editor': {
    name: 'Video Editor',
    title: 'Video Editor Tools',
    description:
      'Trim, crop, and enhance videos online without installing desktop software.',
  },
  'image-editor': {
    name: 'Image Editor',
    title: 'Image Editor Tools',
    description:
      'Edit and enhance images online with quick adjustments and exports.',
  },
  'audio-editor': {
    name: 'Audio Editor',
    title: 'Audio Editor Tools',
    description:
      'Trim, merge, and refine audio tracks online with fast exports.',
  },
  view: {
    name: 'PDF',
    title: 'PDF',
    description: 'Open, read, and edit PDF files instantly in your browser.',
  },
});

type RegistryRecord = Record<string, unknown>;

type CatalogFormatInfo = {
  name: string;
  fullName: string;
  description: string;
  details?: readonly string[];
};

export type CatalogToolContent = DeepReadonly<{
  tool: {
    id?: string;
    route?: string;
    operation?: ToolOperation;
    title: string;
    subtitle: string;
    from: string;
    to: string;
    accept?: string;
    requiresFFmpeg?: boolean;
    renderer?: 'table';
    showInTableLinks?: boolean;
  };
  videoSection?: { embedId?: string };
  faqs?: readonly { question: string; answer: string }[];
  aboutSection?: {
    title?: string;
    fromFormat: CatalogFormatInfo;
    toFormat: CatalogFormatInfo;
  };
  productLinks?: {
    appsUrl?: string;
    serplyUrl?: string;
    githubRepoUrl?: string;
  };
  features?: readonly string[];
  screenshots?: readonly {
    url: string;
    alt?: string;
    caption?: string;
  }[];
  reviews?: readonly {
    author: string;
    rating?: number;
    date?: string;
    body: string;
  }[];
  sourceLinks?: readonly { label: string; url: string }[];
  supportedOperatingSystems?: readonly string[];
  supportedRegions?: readonly string[];
  permissionJustifications?: readonly {
    permission: string;
    justification: string;
  }[];
  keywords?: readonly string[];
  howTo?: { title: string; intro?: string; steps: readonly string[] };
  infoArticle?: { title: string; markdown: string };
  changelog?: readonly { date: string; changes: readonly string[] }[];
  relatedTools?: readonly {
    toolId?: string;
    href?: string;
    title: string;
    description?: string;
  }[];
  blogPosts?: readonly {
    title: string;
    subtitle?: string;
    description?: string;
    href: string;
    category?: string;
  }[];
}>;

export type CatalogPageContent = DeepReadonly<
  Omit<CatalogToolContent, 'tool'> & {
    tool: Omit<CatalogToolContent['tool'], 'id' | 'route' | 'operation'> & {
      id: string;
      route: string;
      operation: ToolOperation;
    };
  }
>;

export type CatalogRelatedTool = DeepReadonly<{
  kind: 'tool';
  id: string;
  name: string;
  description: string;
  route: string;
}>;

export type CatalogRelatedExternalLink = DeepReadonly<{
  kind: 'external';
  name: string;
  description: string;
  route: string;
}>;

export type CatalogRelatedItem =
  | CatalogRelatedTool
  | CatalogRelatedExternalLink;

export type CatalogRelatedToolsQuery = DeepReadonly<{
  currentFrom?: string;
  currentTo?: string;
  currentRoute?: string;
  currentToolId?: string;
  relatedTools?: NonNullable<CatalogToolContent['relatedTools']>;
}>;

const REGISTRY_FIELDS = new Set([
  'id',
  'name',
  'description',
  'operation',
  'route',
  'from',
  'to',
  'isActive',
  'tags',
  'keywords',
  'priority',
  'isBeta',
  'isNew',
  'isPopular',
  'requiresFFmpeg',
  'pageContentProfile',
  'content',
  'video',
]);

export type CatalogTool = DeepReadonly<{
  id: string;
  name: string;
  description: string;
  operation: ToolOperation;
  route: string;
  canonicalRoute: string;
  isActive: boolean;
  from: string | null;
  to: string | null;
  tags: readonly string[];
  keywords: readonly string[];
  priority: number | null;
  requiresFFmpeg: boolean;
  isBeta: boolean;
  isNew: boolean;
  isPopular: boolean;
  video: string | null;
  pageContentProfile: CatalogPageContentProfile | null;
  content: CatalogToolContent | null;
  display: {
    title: string;
    description: string;
    from: string | null;
    to: string | null;
  };
}>;

export type ToolDirectoryEntry = DeepReadonly<{
  id: string;
  name: string;
  description: string;
  category: ToolOperation;
  href: string;
  tags: readonly string[];
  isNew: boolean;
  isPopular: boolean;
}>;

export type ToolDirectoryCategory = DeepReadonly<{
  id: ToolOperation;
  name: string;
  title: string;
  description: string;
  count: number;
  href: string;
}>;

export type ToolCatalog = DeepReadonly<{
  tools: readonly CatalogTool[];
  activeTools: readonly CatalogTool[];
  availableOperations: readonly ToolOperation[];
  directoryEntries: readonly ToolDirectoryEntry[];
  directoryCategories: readonly ToolDirectoryCategory[];
  getById(id: string): CatalogTool | undefined;
  getByRoute(route: string): CatalogTool | undefined;
  getToolsByOperation(operation: ToolOperation): readonly CatalogTool[];
  getDirectoryTools(operation: ToolOperation): readonly ToolDirectoryEntry[];
  getPageContent(id: string): CatalogPageContent | undefined;
  getRelatedItems(
    query: CatalogRelatedToolsQuery,
  ): readonly CatalogRelatedItem[];
}>;

function isRecord(value: unknown): value is RegistryRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepFreezeClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => deepFreezeClone(item))) as T;
  }
  if (isRecord(value)) {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          deepFreezeClone(item),
        ]),
      ),
    ) as T;
  }
  return value;
}

function assertAllowedFields(
  record: RegistryRecord,
  fields: readonly string[],
  location: string,
): void {
  const allowed = new Set(fields);
  for (const field of Object.keys(record)) {
    if (!allowed.has(field)) {
      throw new TypeError(`${location} has unsupported field: ${field}`);
    }
  }
}

function requiredRecord(
  record: RegistryRecord,
  field: string,
  location: string,
): RegistryRecord {
  const value = record[field];
  if (!isRecord(value)) {
    throw new TypeError(`${location}.${field} must be an object`);
  }
  return value;
}

function optionalRecord(
  record: RegistryRecord,
  field: string,
  location: string,
): RegistryRecord | null {
  const value = record[field];
  if (value === undefined) return null;
  if (!isRecord(value)) {
    throw new TypeError(`${location}.${field} must be an object when provided`);
  }
  return value;
}

function optionalObjectArray(
  record: RegistryRecord,
  field: string,
  location: string,
  validate: (item: RegistryRecord, location: string) => void,
): void {
  const value = record[field];
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new TypeError(`${location}.${field} must be an array when provided`);
  }
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      throw new TypeError(`${location}.${field}[${index}] must be an object`);
    }
    validate(item, `${location}.${field}[${index}]`);
  });
}

function optionalFiniteNumber(
  record: RegistryRecord,
  field: string,
  location: string,
): void {
  const value = record[field];
  if (
    value !== undefined &&
    (typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw new TypeError(
      `${location}.${field} must be a finite number when provided`,
    );
  }
}

function requiredString(
  record: RegistryRecord,
  field: string,
  location: string,
): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${location}.${field} must be a non-empty string`);
  }
  return value;
}

function optionalString(
  record: RegistryRecord,
  field: string,
  location: string,
): string | null {
  const value = record[field];
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(
      `${location}.${field} must be a non-empty string when provided`,
    );
  }
  return value;
}

function optionalStringArray(
  record: RegistryRecord,
  field: string,
  location: string,
): readonly string[] {
  const value = record[field];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError(`${location}.${field} must contain only strings`);
  }
  return Object.freeze([...value]);
}

function requiredStringArray(
  record: RegistryRecord,
  field: string,
  location: string,
): void {
  const value = record[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError(`${location}.${field} must contain only strings`);
  }
}

function validateStringObject(
  record: RegistryRecord,
  requiredFields: readonly string[],
  optionalFields: readonly string[],
  location: string,
): void {
  assertAllowedFields(record, [...requiredFields, ...optionalFields], location);
  requiredFields.forEach((field) => requiredString(record, field, location));
  optionalFields.forEach((field) => optionalString(record, field, location));
}

function optionalBoolean(
  record: RegistryRecord,
  field: string,
  location: string,
): boolean {
  const value = record[field];
  if (value === undefined) return false;
  if (typeof value !== 'boolean') {
    throw new TypeError(`${location}.${field} must be a boolean when provided`);
  }
  return value;
}

function optionalPriority(
  record: RegistryRecord,
  location: string,
): number | null {
  const value = record.priority;
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(
      `${location}.priority must be a finite number when provided`,
    );
  }
  return value;
}

function normalizeRoute(route: string): string {
  return route === '/' ? route : `${route.replace(/\/+$/, '')}/`;
}

function validateRoute(route: string, location: string): void {
  if (
    !route.startsWith('/') ||
    route.startsWith('//') ||
    route === '/' ||
    /[?#\s]/.test(route)
  ) {
    throw new TypeError(`${location}.route must be a canonical absolute route`);
  }
}

export function isToolOperation(value: unknown): value is ToolOperation {
  return (
    typeof value === 'string' &&
    TOOL_OPERATION_ORDER.includes(value as ToolOperation)
  );
}

function optionalPageContentProfile(
  record: RegistryRecord,
  location: string,
): CatalogPageContentProfile | null {
  const value = record.pageContentProfile;
  if (value === undefined) return null;
  if (
    typeof value !== 'string' ||
    !CATALOG_PAGE_CONTENT_PROFILES.includes(
      value as CatalogPageContentProfile,
    )
  ) {
    throw new TypeError(
      `${location}.pageContentProfile must be a supported Catalog content profile`,
    );
  }
  return value as CatalogPageContentProfile;
}

function validateFormatInfo(record: RegistryRecord, location: string): void {
  assertAllowedFields(
    record,
    ['name', 'fullName', 'description', 'details'],
    location,
  );
  requiredString(record, 'name', location);
  requiredString(record, 'fullName', location);
  requiredString(record, 'description', location);
  optionalStringArray(record, 'details', location);
}

function validateToolContent(content: RegistryRecord, location: string): void {
  assertAllowedFields(
    content,
    [
      'tool',
      'videoSection',
      'faqs',
      'aboutSection',
      'productLinks',
      'features',
      'screenshots',
      'reviews',
      'sourceLinks',
      'supportedOperatingSystems',
      'supportedRegions',
      'permissionJustifications',
      'keywords',
      'howTo',
      'infoArticle',
      'changelog',
      'relatedTools',
      'blogPosts',
    ],
    location,
  );

  const tool = requiredRecord(content, 'tool', location);
  assertAllowedFields(
    tool,
    [
      'id',
      'route',
      'operation',
      'title',
      'subtitle',
      'from',
      'to',
      'accept',
      'requiresFFmpeg',
      'renderer',
      'showInTableLinks',
    ],
    `${location}.tool`,
  );
  for (const field of ['title', 'subtitle', 'from', 'to']) {
    requiredString(tool, field, `${location}.tool`);
  }
  for (const field of ['id', 'route', 'operation', 'accept', 'renderer']) {
    optionalString(tool, field, `${location}.tool`);
  }
  optionalBoolean(tool, 'requiresFFmpeg', `${location}.tool`);
  optionalBoolean(tool, 'showInTableLinks', `${location}.tool`);
  if (tool.renderer !== undefined && tool.renderer !== 'table') {
    throw new TypeError(`${location}.tool.renderer must be table when provided`);
  }
  if (tool.operation !== undefined && !isToolOperation(tool.operation)) {
    throw new TypeError(
      `${location}.tool.operation must be a supported Tool operation`,
    );
  }
  if (typeof tool.route === 'string') {
    validateRoute(tool.route, `${location}.tool`);
  }

  const videoSection = optionalRecord(content, 'videoSection', location);
  if (videoSection) {
    validateStringObject(
      videoSection,
      [],
      ['embedId'],
      `${location}.videoSection`,
    );
  }

  optionalObjectArray(content, 'faqs', location, (item, itemLocation) =>
    validateStringObject(item, ['question', 'answer'], [], itemLocation),
  );

  const aboutSection = optionalRecord(content, 'aboutSection', location);
  if (aboutSection) {
    assertAllowedFields(
      aboutSection,
      ['title', 'fromFormat', 'toFormat'],
      `${location}.aboutSection`,
    );
    optionalString(aboutSection, 'title', `${location}.aboutSection`);
    validateFormatInfo(
      requiredRecord(aboutSection, 'fromFormat', `${location}.aboutSection`),
      `${location}.aboutSection.fromFormat`,
    );
    validateFormatInfo(
      requiredRecord(aboutSection, 'toFormat', `${location}.aboutSection`),
      `${location}.aboutSection.toFormat`,
    );
  }

  const productLinks = optionalRecord(content, 'productLinks', location);
  if (productLinks) {
    validateStringObject(
      productLinks,
      [],
      ['appsUrl', 'serplyUrl', 'githubRepoUrl'],
      `${location}.productLinks`,
    );
  }

  for (const field of [
    'features',
    'supportedOperatingSystems',
    'supportedRegions',
    'keywords',
  ]) {
    optionalStringArray(content, field, location);
  }

  optionalObjectArray(content, 'screenshots', location, (item, itemLocation) =>
    validateStringObject(item, ['url'], ['alt', 'caption'], itemLocation),
  );
  optionalObjectArray(content, 'reviews', location, (item, itemLocation) => {
    assertAllowedFields(
      item,
      ['author', 'rating', 'date', 'body'],
      itemLocation,
    );
    requiredString(item, 'author', itemLocation);
    requiredString(item, 'body', itemLocation);
    optionalString(item, 'date', itemLocation);
    optionalFiniteNumber(item, 'rating', itemLocation);
  });
  optionalObjectArray(content, 'sourceLinks', location, (item, itemLocation) =>
    validateStringObject(item, ['label', 'url'], [], itemLocation),
  );
  optionalObjectArray(
    content,
    'permissionJustifications',
    location,
    (item, itemLocation) =>
      validateStringObject(
        item,
        ['permission', 'justification'],
        [],
        itemLocation,
      ),
  );

  const howTo = optionalRecord(content, 'howTo', location);
  if (howTo) {
    assertAllowedFields(
      howTo,
      ['title', 'intro', 'steps'],
      `${location}.howTo`,
    );
    requiredString(howTo, 'title', `${location}.howTo`);
    optionalString(howTo, 'intro', `${location}.howTo`);
    requiredStringArray(howTo, 'steps', `${location}.howTo`);
  }

  const infoArticle = optionalRecord(content, 'infoArticle', location);
  if (infoArticle) {
    validateStringObject(
      infoArticle,
      ['title', 'markdown'],
      [],
      `${location}.infoArticle`,
    );
  }

  optionalObjectArray(content, 'changelog', location, (item, itemLocation) => {
    assertAllowedFields(item, ['date', 'changes'], itemLocation);
    requiredString(item, 'date', itemLocation);
    requiredStringArray(item, 'changes', itemLocation);
  });
  optionalObjectArray(content, 'relatedTools', location, (item, itemLocation) =>
    validateStringObject(
      item,
      ['title'],
      ['toolId', 'href', 'description'],
      itemLocation,
    ),
  );
  optionalObjectArray(content, 'blogPosts', location, (item, itemLocation) =>
    validateStringObject(
      item,
      ['title', 'href'],
      ['subtitle', 'description', 'category'],
      itemLocation,
    ),
  );
}

function contentRecord(
  record: RegistryRecord,
  location: string,
): CatalogToolContent | null {
  const value = record.content;
  if (value === undefined) return null;
  if (!isRecord(value)) {
    throw new TypeError(`${location}.content must be an object when provided`);
  }
  validateToolContent(value, `${location}.content`);
  return deepFreezeClone(value) as CatalogToolContent;
}

function contentString(
  content: CatalogToolContent | null,
  field: string,
): string | null {
  const value = content?.tool[field as keyof CatalogToolContent['tool']];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function normalizeTool(value: unknown, index: number): CatalogTool {
  const location = `registry[${index}]`;
  if (!isRecord(value)) {
    throw new TypeError(`${location} must be an object`);
  }
  for (const field of Object.keys(value)) {
    if (!REGISTRY_FIELDS.has(field)) {
      throw new TypeError(`${location} has unsupported field: ${field}`);
    }
  }

  const id = requiredString(value, 'id', location);
  const name = requiredString(value, 'name', location);
  const description = requiredString(value, 'description', location);
  const route = requiredString(value, 'route', location);
  validateRoute(route, location);
  if (!isToolOperation(value.operation)) {
    throw new TypeError(
      `${location}.operation must be a supported Tool operation`,
    );
  }
  if (typeof value.isActive !== 'boolean') {
    throw new TypeError(`${location}.isActive must be a boolean`);
  }

  const from = optionalString(value, 'from', location);
  const to = optionalString(value, 'to', location);
  const tags = optionalStringArray(value, 'tags', location);
  const keywords = optionalStringArray(value, 'keywords', location);
  const content = contentRecord(value, location);
  const pageContentProfile = optionalPageContentProfile(value, location);
  if (
    pageContentProfile === 'legacy-conversion-v1' &&
    (content !== null ||
      (value.operation !== 'convert' && value.operation !== 'compress'))
  ) {
    throw new TypeError(
      `${location}.pageContentProfile legacy-conversion-v1 requires a content-free convert or compress Tool`,
    );
  }
  if (
    pageContentProfile === 'legacy-pdf-v1' &&
    (content !== null ||
      (value.operation !== 'edit' && value.operation !== 'view'))
  ) {
    throw new TypeError(
      `${location}.pageContentProfile legacy-pdf-v1 requires a content-free edit or view Tool`,
    );
  }
  if (pageContentProfile === 'legacy-sections-v1' && content === null) {
    throw new TypeError(
      `${location}.pageContentProfile legacy-sections-v1 requires explicit Tool content`,
    );
  }

  return Object.freeze({
    id,
    name,
    description,
    operation: value.operation,
    route,
    canonicalRoute: normalizeRoute(route),
    isActive: value.isActive,
    from,
    to,
    tags,
    keywords,
    priority: optionalPriority(value, location),
    requiresFFmpeg: optionalBoolean(value, 'requiresFFmpeg', location),
    isBeta: optionalBoolean(value, 'isBeta', location),
    isNew: optionalBoolean(value, 'isNew', location),
    isPopular: optionalBoolean(value, 'isPopular', location),
    video: optionalString(value, 'video', location),
    pageContentProfile,
    content,
    display: Object.freeze({
      title: contentString(content, 'title') ?? name,
      description: contentString(content, 'subtitle') ?? description,
      from: from ?? contentString(content, 'from'),
      to: to ?? contentString(content, 'to'),
    }),
  });
}

function directoryEntry(tool: CatalogTool): ToolDirectoryEntry {
  return Object.freeze({
    id: tool.id,
    name: tool.name,
    description: tool.description,
    category: tool.operation,
    href: tool.route,
    tags: Object.freeze(
      Array.from(
        new Set(
          [tool.from, tool.to, ...tool.tags, ...tool.keywords].filter(
            (value): value is string => value !== null,
          ),
        ),
      ),
    ),
    isNew: tool.isNew,
    isPopular: tool.isPopular,
  });
}

export function createToolCatalog(registry: unknown): ToolCatalog {
  if (!Array.isArray(registry)) {
    throw new TypeError('registry must be an array');
  }

  const tools = Object.freeze(registry.map(normalizeTool));
  const byId = new Map<string, CatalogTool>();
  const byRoute = new Map<string, CatalogTool>();
  const byOperation = new Map<ToolOperation, CatalogTool[]>();

  for (const tool of tools) {
    if (byId.has(tool.id)) {
      throw new TypeError(`duplicate Tool id: ${tool.id}`);
    }
    if (byRoute.has(tool.canonicalRoute)) {
      throw new TypeError(`duplicate normalized route: ${tool.canonicalRoute}`);
    }
    byId.set(tool.id, tool);
    byRoute.set(tool.canonicalRoute, tool);
    const operationTools = byOperation.get(tool.operation) ?? [];
    operationTools.push(tool);
    byOperation.set(tool.operation, operationTools);
  }

  const activeTools = Object.freeze(tools.filter((tool) => tool.isActive));
  const pageContentById = new Map(
    activeTools.map((tool) => [
      tool.id,
      deepFreezeClone(buildPageContent(tool)),
    ]),
  );
  const directoryEntries = Object.freeze(activeTools.map(directoryEntry));
  const availableOperations = Object.freeze(
    TOOL_OPERATION_ORDER.filter((operation) =>
      activeTools.some((tool) => tool.operation === operation),
    ),
  );
  const directoryCategories = Object.freeze(
    availableOperations.map((operation) => {
      const taxonomy = TOOL_OPERATION_TAXONOMY[operation];
      return Object.freeze({
        id: operation,
        name: taxonomy.name,
        title: taxonomy.title,
        description: taxonomy.description,
        count: directoryEntries.filter((tool) => tool.category === operation)
          .length,
        href: `/category/${operation}/`,
      });
    }),
  );

  const sameRoute = (left: string, right: string): boolean =>
    left.startsWith('/') && right.startsWith('/')
      ? normalizeRoute(left) === normalizeRoute(right)
      : left === right;

  const getRelatedItems = (
    query: CatalogRelatedToolsQuery,
  ): readonly CatalogRelatedItem[] => {
    const curated = (query.relatedTools ?? [])
      .map((entry): CatalogRelatedItem | null => {
        let resolved: CatalogTool | undefined;
        if (entry.toolId) {
          resolved = byId.get(entry.toolId);
        } else if (entry.href?.startsWith('/')) {
          resolved = byRoute.get(normalizeRoute(entry.href));
        }

        if (resolved) {
          if (!resolved.isActive) return null;
          return {
            kind: 'tool',
            id: resolved.id,
            name: entry.title || resolved.name,
            description: entry.description ?? resolved.description,
            route: resolved.route,
          };
        }

        if (entry.href && !entry.href.startsWith('/')) {
          return {
            kind: 'external',
            name: entry.title,
            description: entry.description ?? '',
            route: entry.href,
          };
        }
        return null;
      })
      .filter((tool): tool is CatalogRelatedItem => tool !== null)
      .filter(
        (tool) =>
          (!query.currentToolId ||
            tool.kind === 'external' ||
            tool.id !== query.currentToolId) &&
          (!query.currentRoute || !sameRoute(tool.route, query.currentRoute)),
      );

    const fallback =
      query.currentFrom && query.currentTo
        ? activeTools
            .filter(
              (tool) =>
                tool.from === query.currentFrom ||
                tool.to === query.currentFrom ||
                tool.from === query.currentTo ||
                tool.to === query.currentTo,
            )
            .filter(
              (tool) =>
                (!query.currentToolId || tool.id !== query.currentToolId) &&
                (!query.currentRoute ||
                  !sameRoute(tool.route, query.currentRoute)),
            )
            .map((tool) => ({
              kind: 'tool' as const,
              id: tool.id,
              name: tool.name,
              description: tool.description,
              route: tool.route,
            }))
        : [];

    const selected = curated.length > 0 ? curated : fallback;
    return deepFreezeClone(
      Array.from(new Map(selected.map((tool) => [tool.route, tool])).values()),
    );
  };

  return Object.freeze({
    tools,
    activeTools,
    availableOperations,
    directoryEntries,
    directoryCategories,
    getById: (id: string) => byId.get(id),
    getByRoute: (route: string) => byRoute.get(normalizeRoute(route)),
    getToolsByOperation: (operation: ToolOperation) =>
      Object.freeze([...(byOperation.get(operation) ?? [])]),
    getDirectoryTools: (operation: ToolOperation) =>
      Object.freeze(
        directoryEntries.filter((tool) => tool.category === operation),
      ),
    getPageContent: (id: string) => pageContentById.get(id),
    getRelatedItems,
  });
}

export const toolCatalog = createToolCatalog(registryData as unknown);
