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
