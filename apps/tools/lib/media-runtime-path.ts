import type { ToolRuntimePath } from './tool-runtime-observations.ts';

function extractorHost(hostname: string) {
  const host = hostname.toLowerCase();
  return (
    host === 'youtu.be' ||
    host === 'youtube.com' ||
    host.endsWith('.youtube.com') ||
    host === 'youtube-nocookie.com' ||
    host.endsWith('.youtube-nocookie.com') ||
    host === 'tube8.com' ||
    host.endsWith('.tube8.com')
  );
}

export function classifyMediaRuntimePath(
  input:
    | Readonly<{ kind: 'file' }>
    | Readonly<{ kind: 'url'; url: string }>
    | Readonly<{ kind: string }>,
): ToolRuntimePath {
  if (input.kind === 'file') return 'upload';
  if (input.kind !== 'url' || !('url' in input)) return 'other';
  try {
    return extractorHost(new URL(input.url).hostname)
      ? 'youtube-extractor'
      : 'direct-url';
  } catch {
    return 'other';
  }
}
