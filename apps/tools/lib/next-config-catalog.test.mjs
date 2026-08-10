import assert from 'node:assert/strict';
import process from 'node:process';
import test from 'node:test';

import { operationalToolCatalog } from '../../../packages/app-core/src/lib/tool-catalog-adapter.mjs';

const transcriptionToolIds = [
  'audio-to-text',
  'audio-to-transcript',
  'mp3-to-transcript',
  'mp4-to-transcript',
  'tiktok-to-transcript',
  'video-to-transcript',
  'youtube-to-transcript',
  'youtube-to-transcript-generator',
];

async function headerSources(singleThread) {
  const previousValue = process.env.NEXT_PUBLIC_FFMPEG_SINGLE_THREAD;
  process.env.NEXT_PUBLIC_FFMPEG_SINGLE_THREAD = String(singleThread);
  try {
    const { default: nextConfig } = await import(
      `../next.config.mjs?single-thread=${singleThread}`
    );
    return (await nextConfig.headers()).map(({ source }) => source).sort();
  } finally {
    if (previousValue === undefined) {
      delete process.env.NEXT_PUBLIC_FFMPEG_SINGLE_THREAD;
    } else {
      process.env.NEXT_PUBLIC_FFMPEG_SINGLE_THREAD = previousValue;
    }
  }
}

function routePattern(route) {
  return `${route.replace(/\/$/, '')}/:path*`;
}

test('Catalog-backed isolation headers preserve public Tool route patterns', async () => {
  const singleThreadSources = await headerSources(true);
  const expectedTranscriptionSources = transcriptionToolIds
    .map((toolId) =>
      operationalToolCatalog.tools.find((tool) => tool.id === toolId),
    )
    .map((tool) => routePattern(tool.canonicalRoute))
    .sort();

  assert.deepEqual(singleThreadSources, expectedTranscriptionSources);
  assert.equal(singleThreadSources.some((source) => source.includes('//')), false);

  const multiThreadSources = await headerSources(false);
  const expectedMultiThreadSources = [
    ...new Set([
      ...expectedTranscriptionSources,
      ...operationalToolCatalog.activeTools
        .filter((tool) => tool.requiresFFmpeg)
        .map((tool) => routePattern(tool.canonicalRoute)),
    ]),
  ].sort();

  assert.deepEqual(multiThreadSources, expectedMultiThreadSources);
  assert.equal(multiThreadSources.some((source) => source.includes('//')), false);
});
