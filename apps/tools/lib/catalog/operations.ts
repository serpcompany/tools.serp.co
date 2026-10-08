// Every Tool operation, in the order discovery lists them: directory and link
// hub tabs, /categories/ and the categories sitemap. ToolOperation derives from
// this list, and validate.ts rejects a registry entry with any other value.
//
// The three *-editor operations aren't in the documented seven: each holds one
// active placeholder Tool (/audio-editor/, /image-editor/, /video-editor/) that
// renders ToolPlaceholder ("coming soon") and has its own category page and
// sitemap entries.
export const OPERATIONS = [
  "convert",
  "download",
  "compress",
  "combine",
  "bulk",
  "edit",
  "video-editor",
  "image-editor",
  "audio-editor",
  "view",
] as const;

export type ToolOperation = (typeof OPERATIONS)[number];

export const OPERATION_LABELS: Record<ToolOperation, string> = {
  convert: "Convert",
  download: "Downloaders",
  compress: "Compress",
  combine: "Combine",
  bulk: "Bulk Operations",
  edit: "Edit",
  "video-editor": "Video Editor",
  "image-editor": "Image Editor",
  "audio-editor": "Audio Editor",
  view: "PDF",
};

// Each operation's category: the heading and description on its
// /category/{operation}/ page, its /categories/ card and its link hub tab.
export const CATEGORY_CONTENT: Record<ToolOperation, { title: string; description: string }> = {
  convert: {
    title: "Convert Tools",
    description: "Convert image, audio, video, document, and data files directly in your browser.",
  },
  download: {
    title: "Downloaders",
    description: "Download supported public videos and media links straight to your device.",
  },
  compress: {
    title: "Compress Tools",
    description: "Reduce file size online while keeping the output usable and shareable.",
  },
  combine: {
    title: "Combine Tools",
    description: "Merge multiple files into one output without installing extra software.",
  },
  bulk: {
    title: "Bulk Operations",
    description: "Run batch file workflows and multi-file operations in a single pass.",
  },
  edit: {
    title: "Edit Tools",
    description: "Open and edit supported files online without installing desktop software.",
  },
  "video-editor": {
    title: "Video Editor Tools",
    description: "Trim, crop, and enhance videos online without installing desktop software.",
  },
  "image-editor": {
    title: "Image Editor Tools",
    description: "Edit and enhance images online with quick adjustments and exports.",
  },
  "audio-editor": {
    title: "Audio Editor Tools",
    description: "Trim, merge, and refine audio tracks online with fast exports.",
  },
  view: {
    title: "PDF",
    description: "Open, read, and edit PDF files instantly in your browser.",
  },
};

const OPERATION_SET: ReadonlySet<string> = new Set(OPERATIONS);

export function isToolOperation(value: unknown): value is ToolOperation {
  return typeof value === "string" && OPERATION_SET.has(value);
}

// The operations that at least one of these Tools is active in, in OPERATIONS
// order. catalog.ts applies it to the registry.
export function operationsUsedBy(
  tools: readonly { isActive: boolean; operation: string }[],
): ToolOperation[] {
  const used = new Set(tools.filter((tool) => tool.isActive).map((tool) => tool.operation));
  return OPERATIONS.filter((operation) => used.has(operation));
}
