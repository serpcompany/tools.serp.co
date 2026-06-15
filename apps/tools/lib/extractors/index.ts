import { tube8Extractor } from "./tube8";
import type { ExtractedMediaFormat, ExtractorContext, MediaExtractor } from "./types";

export type { ExtractedMediaFormat, ExtractorContext, MediaExtractor } from "./types";

export const extractors: MediaExtractor[] = [tube8Extractor];

export async function extractWithRegisteredExtractor(
  url: URL,
  context: ExtractorContext,
): Promise<ExtractedMediaFormat | null> {
  for (const extractor of extractors) {
    if (!extractor.canHandle(url)) continue;
    const result = await extractor.extract(url, context);
    if (result) return result;
  }

  return null;
}
