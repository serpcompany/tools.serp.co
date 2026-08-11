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

async function headerRules(singleThread) {
  const previousValue = process.env.NEXT_PUBLIC_FFMPEG_SINGLE_THREAD;
  process.env.NEXT_PUBLIC_FFMPEG_SINGLE_THREAD = String(singleThread);
  try {
    const { default: nextConfig } = await import(
      `../next.config.mjs?single-thread=${singleThread}`
    );
    return await nextConfig.headers();
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
  const singleThreadSources = (await headerRules(true))
    .map(({ source }) => source)
    .filter((source) => !source.startsWith('/_next/'))
    .sort();
  const expectedTranscriptionSources = transcriptionToolIds
    .map((toolId) =>
      operationalToolCatalog.tools.find((tool) => tool.id === toolId),
    )
    .map((tool) => routePattern(tool.canonicalRoute))
    .sort();

  assert.deepEqual(singleThreadSources, expectedTranscriptionSources);
  assert.equal(singleThreadSources.some((source) => source.includes('//')), false);

  const multiThreadSources = (await headerRules(false))
    .map(({ source }) => source)
    .filter((source) => !source.startsWith('/_next/'))
    .sort();
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

test('same-origin Next worker chunks opt into isolated transcription pages', async () => {
  for (const singleThread of [true, false]) {
    const workerChunks = (await headerRules(singleThread)).find(
      ({ source }) => source === '/_next/static/chunks/:path*',
    );

    assert.deepEqual(workerChunks, {
      source: '/_next/static/chunks/:path*',
      headers: [
        { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
      ],
    });
  }
});
