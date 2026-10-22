// Checks that the registry matches the Tool type that catalog.ts casts it to:
// unique ids, public paths and videos, a known operation, and the content and
// video shapes. Run by the catalog tests and `pnpm verify:catalog`, never at
// runtime.

import { toolHref } from "./href.ts";
import { OPERATIONS, isToolOperation } from "./operations.ts";

type Check = (value: unknown, path: string, errors: string[]) => void;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const string: Check = (value, path, errors) => {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${path} must be a non-empty string`);
  }
};

const boolean: Check = (value, path, errors) => {
  if (typeof value !== "boolean") errors.push(`${path} must be a boolean`);
};

const number: Check = (value, path, errors) => {
  if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`${path} must be a number`);
};

const optional =
  (check: Check): Check =>
  (value, path, errors) => {
    if (value !== undefined) check(value, path, errors);
  };

const arrayOf =
  (check: Check): Check =>
  (value, path, errors) => {
    if (!Array.isArray(value)) {
      errors.push(`${path} must be an array`);
      return;
    }
    value.forEach((item, index) => check(item, `${path}[${index}]`, errors));
  };

// An object with exactly these fields: an unknown field is a typo or a field
// no renderer reads.
const object =
  (fields: Record<string, Check>): Check =>
  (value, path, errors) => {
    if (!isRecord(value)) {
      errors.push(`${path} must be an object`);
      return;
    }
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(fields, key)) errors.push(`${path}.${key} is not a known field`);
    }
    for (const [key, check] of Object.entries(fields)) check(value[key], `${path}.${key}`, errors);
  };

const strings = arrayOf(string);

// A string the pattern matches in full.
const matching =
  (pattern: RegExp, what: string): Check =>
  (value, path, errors) => {
    string(value, path, errors);
    if (typeof value === "string" && !pattern.test(value)) {
      errors.push(`${path} must be ${what}, got ${JSON.stringify(value)}`);
    }
  };

// Google reads at most this much of a video sitemap's <video:description>.
export const VIDEO_DESCRIPTION_MAX = 2048;

// ToolVideo in types/index.d.ts: the values YouTube publishes for a video, in
// the forms the watch page's VideoObject and the video sitemap need
// (lib/videos.ts).
const video = object({
  id: matching(/^[A-Za-z0-9_-]{11}$/, "an 11-character YouTube video id"),
  title: string,
  description: (value, path, errors) => {
    string(value, path, errors);
    if (typeof value !== "string") return;
    if (value.length > VIDEO_DESCRIPTION_MAX) {
      errors.push(`${path} must be at most ${VIDEO_DESCRIPTION_MAX} characters, got ${value.length}`);
    }
    if (/<[a-z/!]/i.test(value)) errors.push(`${path} must be plain text, not HTML`);
  },
  uploadDate: (value, path, errors) => {
    matching(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/,
      "an ISO 8601 date and time with a time zone, e.g. 2026-10-22T00:15:20-07:00",
    )(value, path, errors);
    if (typeof value === "string" && Number.isNaN(Date.parse(value))) {
      errors.push(`${path} is not a real date, got ${JSON.stringify(value)}`);
    }
  },
  duration: matching(
    /^PT(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?$/,
    "an ISO 8601 duration in hours, minutes and seconds, e.g. PT28S",
  ),
});

const formatInfo = object({
  name: string,
  fullName: string,
  description: string,
  details: optional(strings),
});

// ToolContent in types/index.d.ts.
const content = object({
  tool: object({
    title: string,
    subtitle: string,
    from: string,
    to: string,
    accept: optional(string),
  }),
  seo: optional(
    object({ title: string, h1: string, description: string, howToHeading: optional(string) }),
  ),
  pairNotes: optional(object({ title: string, points: strings })),
  faqs: optional(arrayOf(object({ question: string, answer: string }))),
  aboutSection: optional(
    object({ title: optional(string), fromFormat: formatInfo, toFormat: formatInfo }),
  ),
  productLinks: optional(
    object({ appsUrl: optional(string), serplyUrl: optional(string), githubRepoUrl: optional(string) }),
  ),
  features: optional(strings),
  screenshots: optional(
    arrayOf(object({ url: string, alt: optional(string), caption: optional(string) })),
  ),
  reviews: optional(
    arrayOf(object({ author: string, rating: optional(number), date: optional(string), body: string })),
  ),
  sourceLinks: optional(arrayOf(object({ label: string, url: string }))),
  supportedOperatingSystems: optional(strings),
  supportedRegions: optional(strings),
  permissionJustifications: optional(
    arrayOf(object({ permission: string, justification: string })),
  ),
  keywords: optional(strings),
  howTo: optional(object({ title: string, intro: optional(string), steps: strings })),
  infoArticle: optional(object({ title: string, markdown: string })),
  changelog: optional(arrayOf(object({ date: string, changes: strings }))),
  relatedTools: optional(
    arrayOf(
      object({
        toolId: optional(string),
        href: optional(string),
        title: string,
        description: optional(string),
      }),
    ),
  ),
  blogPosts: optional(
    arrayOf(
      object({
        title: string,
        subtitle: optional(string),
        description: optional(string),
        href: string,
        category: optional(string),
      }),
    ),
  ),
});

const operation: Check = (value, path, errors) => {
  if (!isToolOperation(value)) {
    errors.push(
      `${path} is ${JSON.stringify(value)}, not one of ${OPERATIONS.join(", ")} (lib/catalog/operations.ts)`,
    );
  }
};

// A route as stored: absolute, one form per page, no trailing slash.
const route: Check = (value, path, errors) => {
  string(value, path, errors);
  if (typeof value === "string" && !/^\/[a-z0-9]+(?:[-/][a-z0-9]+)*$/.test(value)) {
    errors.push(`${path} must look like /lowercase-words with no trailing slash, got ${JSON.stringify(value)}`);
  }
};

// Tool in types/index.d.ts.
const tool = object({
  id: string,
  name: string,
  description: string,
  operation,
  from: optional(string),
  to: optional(string),
  route,
  isActive: boolean,
  tags: optional(strings),
  keywords: optional(strings),
  priority: optional(number),
  isBeta: optional(boolean),
  isNew: optional(boolean),
  isPopular: optional(boolean),
  requiresFFmpeg: optional(boolean),
  video: optional(video),
  content: optional(content),
});

// Every problem in the registry, as "<tool id or index>.<field> ..." lines.
// An empty list means the registry matches the Tool type.
export function validateCatalog(registry: unknown): string[] {
  if (!Array.isArray(registry)) return ["the registry must be an array of Tools"];
  const errors: string[] = [];
  const ids = new Set<string>();
  const routes = new Set<string>();
  // Each video has one watch page, and its title and description are its
  // own (the watch-pages standard): which Tool already has each value.
  const videoValues = {
    id: new Map<string, string>(),
    title: new Map<string, string>(),
    description: new Map<string, string>(),
  };
  registry.forEach((entry, index) => {
    const label = isRecord(entry) && typeof entry.id === "string" ? entry.id : `[${index}]`;
    tool(entry, label, errors);
    if (!isRecord(entry)) return;
    if (typeof entry.id === "string") {
      if (ids.has(entry.id)) errors.push(`${label}: duplicate id`);
      ids.add(entry.id);
    }
    // Compared as served: slashed, with legacy aliases (/png-to-png/ is
    // /compress-png/) resolved, the way getToolByRoute looks Tools up.
    if (typeof entry.route === "string") {
      const href = toolHref({ route: entry.route });
      if (routes.has(href)) errors.push(`${label}: duplicate route ${href}`);
      routes.add(href);
    }
    if (isRecord(entry.video)) {
      for (const [field, seen] of Object.entries(videoValues)) {
        const value = entry.video[field];
        if (typeof value !== "string") continue;
        const owner = seen.get(value);
        if (owner !== undefined) errors.push(`${label}.video.${field} repeats ${owner}'s`);
        else seen.set(value, label);
      }
    }
  });
  return errors;
}
