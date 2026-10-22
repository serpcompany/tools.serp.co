import type { ToolOperation } from '../lib/catalog/operations.ts';

// Tool operation types - what the tool does. OPERATIONS in
// lib/catalog/operations.ts is the list.
export type OperationType = ToolOperation;

// Media types - what kind of content the tool works with
export type MediaType =
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'text';

// FAQ item structure
export interface FAQ {
  question: string;
  answer: string;
}

// Related tool structure
export interface RelatedTool {
  toolId?: string;
  href?: string;
  title: string;
  description: string;
}

// About section structure
export interface AboutSection {
  title: string;
  content: string;
  features?: string[];
  relatedTools?: RelatedTool[];
}

// Tool info for page templates
export interface ToolInfo {
  id?: string;
  route?: string;
  operation?: OperationType;
  title: string;
  subtitle: string;
  from: string;
  to: string;
  accept?: string;
  requiresFFmpeg?: boolean;
}

// A Tool's how-to video on the SERP Tools YouTube channel, as the registry
// stores it: the values YouTube publishes for it (issue #374). lib/videos.ts
// derives the rest of its WatchVideo (URLs, thumbnail, length in seconds),
// so a video is added by adding this one record. Its watch page, the /videos/
// library and /sitemap-videos.xml list it, and its converter page shows it.
export interface ToolVideo {
  // The 11-character YouTube id in youtu.be/<id>.
  id: string;
  // Its title on YouTube. No two videos share one.
  title: string;
  // Its description on YouTube, as plain text. No two videos share one.
  description: string;
  // When it was published, as YouTube's uploadDate gives it: ISO 8601 with
  // a time zone, e.g. 2026-10-22T00:15:20-07:00.
  uploadDate: string;
  // Its length, as YouTube's duration gives it: ISO 8601, e.g. PT28S.
  duration: string;
}

// Format info for about section
export interface FormatInfo {
  name: string;
  fullName: string;
  description: string;
  details?: string[];
}

// About formats section
export interface AboutFormatsSection {
  title?: string;
  fromFormat: FormatInfo;
  toFormat: FormatInfo;
}

// How-to section
export interface HowToSectionData {
  title: string;
  intro?: string;
  steps: string[];
}

// Info article section
export interface InfoArticleSectionData {
  title: string;
  markdown: string;
}

// Changelog entry
export interface ChangelogEntry {
  date: string;
  changes: string[];
}

// Blog post
export interface BlogPost {
  title: string;
  subtitle?: string;
  description?: string;
  href: string;
  category?: string;
}

export interface ProductLinks {
  appsUrl?: string;
  serplyUrl?: string;
  githubRepoUrl?: string;
}

export interface ProductImage {
  url: string;
  alt?: string;
  caption?: string;
}

export interface ProductReview {
  author: string;
  rating?: number;
  date?: string;
  body: string;
}

export interface SourceLink {
  label: string;
  url: string;
}

export interface PermissionJustification {
  permission: string;
  justification: string;
}

// A converter or compressor page's search result and heading
// (docs/converter-copy.md). `title` is the page's own title: the layout adds
// " | SERP Tools".
export interface ToolSeo {
  title: string;
  h1: string;
  description: string;
  // The converter page's How-to heading, in place of the generated one.
  howToHeading?: string;
}

// What changes between a converter's two formats, from the engine's real
// behaviour; the page shows it in place of the template article.
export interface PairNotes {
  title: string;
  points: string[];
}

// Tool content structure (landing page data)
export interface ToolContent {
  tool: ToolInfo;
  seo?: ToolSeo;
  pairNotes?: PairNotes;
  // 18 converters have content without FAQs or an about section.
  faqs?: FAQ[];
  aboutSection?: AboutFormatsSection;
  productLinks?: ProductLinks;
  features?: string[];
  screenshots?: ProductImage[];
  reviews?: ProductReview[];
  sourceLinks?: SourceLink[];
  supportedOperatingSystems?: string[];
  supportedRegions?: string[];
  permissionJustifications?: PermissionJustification[];
  keywords?: string[];
  howTo?: HowToSectionData;
  infoArticle?: InfoArticleSectionData;
  changelog?: ChangelogEntry[];
  relatedTools?: RelatedTool[];
  blogPosts?: BlogPost[];
}

// Main tool interface
export interface Tool {
  id: string;
  name: string;
  description: string;
  
  // Taxonomy
  operation: OperationType;
  
  // File formats
  from?: string;
  to?: string;
  
  // Metadata
  route: string;
  isActive: boolean;
  tags?: string[];
  keywords?: string[];
  priority?: number;
  isBeta?: boolean;
  isNew?: boolean;
  isPopular?: boolean;
  requiresFFmpeg?: boolean;
  // Its how-to video (ToolVideo).
  video?: ToolVideo;
  
  // Landing page content
  content?: ToolContent;
}

// Format to media type mapping
export interface FormatMediaMapping {
  [format: string]: MediaType;
}

// Operation definition
export interface OperationDefinition {
  name: string;
  description: string;
  color: string;
}

// Operation definitions type
export type OperationDefinitions = {
  [K in OperationType]: OperationDefinition;
};

// Media type definition
export interface MediaTypeDefinition {
  name: string;
  pluralName: string;
  description: string;
  color: string;
}

// Media type definitions type
export type MediaTypeDefinitions = {
  [K in MediaType]: MediaTypeDefinition;
};
