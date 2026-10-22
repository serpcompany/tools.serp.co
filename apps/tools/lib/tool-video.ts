import { requiresCoepForTool } from "@/lib/coep";
import type { ToolInfo, ToolVideo } from "@/types";

// Whether a converter page shows its Tool's how-to video (the registry's
// `video`). A page that is cross-origin isolated for multi-threaded FFmpeg
// (lib/coep.ts) shows none: YouTube's player and thumbnails send no
// Cross-Origin-Embedder-Policy or Cross-Origin-Resource-Policy, so the
// browser would refuse to load them there. The video's watch page is never
// isolated, so it plays there either way.
export function shownToolVideo(tool: ToolInfo, video: ToolVideo | undefined): ToolVideo | undefined {
  if (!video || requiresCoepForTool(tool)) return undefined;
  return video;
}
