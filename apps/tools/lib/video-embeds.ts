import { requiresCoepForTool } from "@/lib/coep";
import type { ToolInfo, VideoSectionData } from "@/types";

export const YOUTUBE_DEMO_EMBEDS_ENABLED = false;

type GetEnabledVideoEmbedIdParams = {
  tool?: ToolInfo;
  videoSection?: VideoSectionData;
};

export function getEnabledVideoEmbedId({
  tool,
  videoSection,
}: GetEnabledVideoEmbedIdParams): string | undefined {
  if (!YOUTUBE_DEMO_EMBEDS_ENABLED) return undefined;
  if (requiresCoepForTool(tool)) return undefined;

  const embedId = videoSection?.embedId?.trim();
  return embedId || undefined;
}
