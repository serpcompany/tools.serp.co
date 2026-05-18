export type ExtractedMediaFormat = {
  url: string;
  quality: string;
  extension: string;
  contentType: string;
  contentLength: number | null;
  fileName: string;
  referer?: string;
};

export type ExtractorContext = {
  mode: "audio" | "video";
};

export type MediaExtractor = {
  id: string;
  canHandle(url: URL): boolean;
  extract(url: URL, context: ExtractorContext): Promise<ExtractedMediaFormat | null>;
};
