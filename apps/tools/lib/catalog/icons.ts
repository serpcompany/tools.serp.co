// The icon each Tool's card shows, by name. The server picks the name; the
// client ToolCard maps it to a component (lib/tool-icons.ts), so cards carry a
// short key instead of the Tool id.
export const TOOL_ICON_NAMES = [
  "image",
  "file-image",
  "file-json",
  "mic",
  "music",
  "table",
  "type",
  "video",
] as const;

export type ToolIconName = (typeof TOOL_ICON_NAMES)[number];

// What a card shows when its Tool has no entry below.
export const DEFAULT_TOOL_ICON: ToolIconName = "image";

const ICON_BY_TOOL_ID: Record<string, ToolIconName> = {
  "heic-to-jpg": "image",
  "heic-to-jpeg": "image",
  "heic-to-png": "image",
  "heic-to-pdf": "file-image",
  "heif-to-jpg": "image",
  "heif-to-png": "image",
  "heif-to-pdf": "file-image",
  "pdf-to-jpg": "file-image",
  "pdf-to-png": "file-image",
  "pdf-editor": "file-image",
  "pdf-editor-extension": "file-image",
  "pdf-editor-mac": "file-image",
  "pdf-editor-windows": "file-image",
  "pdf-reader": "file-image",
  "pdf-reader-extension": "file-image",
  "pdf-reader-mac": "file-image",
  "pdf-reader-windows": "file-image",
  "pdf-viewer": "file-image",
  "pdf-viewer-extension": "file-image",
  "pdf-viewer-windows": "file-image",
  "jpg-to-pdf": "file-image",
  "jpeg-to-pdf": "file-image",
  "jpg-to-png": "image",
  "png-to-jpg": "image",
  "jpeg-to-png": "image",
  "jpeg-to-jpg": "image",
  "webp-to-png": "image",
  "png-to-webp": "image",
  "jpg-to-webp": "image",
  "jpeg-to-webp": "image",
  "gif-to-webp": "image",
  "webp-to-jpg": "image",
  "webp-to-jpeg": "image",
  "avif-to-png": "image",
  "avif-to-jpg": "image",
  "avif-to-jpeg": "image",
  "bmp-to-jpg": "image",
  "bmp-to-png": "image",
  "ico-to-png": "image",
  "gif-to-jpg": "image",
  "gif-to-png": "image",
  "jfif-to-jpg": "image",
  "jfif-to-jpeg": "image",
  "jfif-to-png": "image",
  "jfif-to-pdf": "file-image",
  "cr2-to-jpg": "image",
  "cr3-to-jpg": "image",
  "dng-to-jpg": "image",
  "arw-to-jpg": "image",
  "jpg-to-svg": "file-image",
  "png-optimizer": "image",
  "csv-combiner": "table",
  "json-to-csv": "file-json",
  "character-counter": "type",
  "mkv-to-mp4": "video",
  "mkv-to-webm": "video",
  "mkv-to-avi": "video",
  "mkv-to-mov": "video",
  "mkv-to-gif": "image",
  "mkv-to-mp3": "music",
  "mkv-to-wav": "music",
  "mkv-to-ogg": "music",
  "batch-compress-png": "image",
  "audio-to-text": "mic",
  "audio-to-transcript": "mic",
  "mp3-to-transcript": "mic",
  "mp4-to-transcript": "mic",
  "video-to-transcript": "mic",
  "tiktok-to-transcript": "mic",
  "youtube-to-transcript": "mic",
  "youtube-to-transcript-generator": "mic",
  "video-downloader": "video",
  "download-loom-videos": "video",
  "video-editor": "video",
  "image-editor": "image",
  "audio-editor": "music",
};

export function toolIconName(toolId: string): ToolIconName {
  if (toolId.startsWith("download-") || toolId.endsWith("-downloader")) {
    return "video";
  }

  return ICON_BY_TOOL_ID[toolId] ?? DEFAULT_TOOL_ICON;
}
