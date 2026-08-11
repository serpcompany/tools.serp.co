export const VERIFIED_MEDIA_FORMATS = Object.freeze([
  "3gp",
  "m4a",
  "m4v",
  "mov",
  "mp3",
  "mp4",
  "webm",
] as const);

export const VERIFIED_MEDIA_MIME_TYPES: Readonly<
  Record<(typeof VERIFIED_MEDIA_FORMATS)[number], readonly string[]>
> = Object.freeze({
  "3gp": ["audio/3gpp", "video/3gpp", "application/octet-stream"],
  m4a: ["audio/mp4", "application/octet-stream"],
  m4v: ["video/mp4", "video/x-m4v", "application/octet-stream"],
  mov: ["video/quicktime", "application/octet-stream"],
  mp3: ["audio/mpeg", "application/octet-stream"],
  mp4: ["video/mp4", "application/octet-stream"],
  webm: ["audio/webm", "video/webm", "application/octet-stream"],
});

export const TRANSCRIPT_OUTPUT = Object.freeze({
  format: "txt" as const,
  mimeType: "text/plain" as const,
});
