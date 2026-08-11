export const TRANSCRIPTION_TOOL_IDS = Object.freeze([
  'audio-to-text',
  'audio-to-transcript',
  'mp3-to-transcript',
  'mp4-to-transcript',
  'tiktok-to-transcript',
  'video-to-transcript',
  'youtube-to-transcript',
  'youtube-to-transcript-generator',
] as const);

const transcriptionToolIds = new Set<string>(TRANSCRIPTION_TOOL_IDS);

export function isTranscriptionToolId(toolId: string): boolean {
  return transcriptionToolIds.has(toolId);
}
