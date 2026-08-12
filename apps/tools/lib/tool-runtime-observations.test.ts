import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadToolRuntimeObservations,
  type ToolRuntimeObservationDatabase,
} from './tool-runtime-observations.ts';
import { classifyMediaRuntimePath } from './media-runtime-path.ts';

test('media telemetry classifies upload, direct-link, and extractor attempts before execution', () => {
  assert.equal(
    classifyMediaRuntimePath('audio-to-text', { kind: 'file' }),
    'upload',
  );
  assert.equal(
    classifyMediaRuntimePath('audio-to-text', {
      kind: 'url',
      url: 'https://cdn.example.test/media/sample.mp3',
    }),
    'direct-url',
  );
  assert.equal(
    classifyMediaRuntimePath('audio-to-text', {
      kind: 'url',
      url: 'https://www.youtube.com/watch?v=3Is2P90qVa0',
    }),
    'youtube-extractor',
  );
  assert.equal(
    classifyMediaRuntimePath('audio-to-text', {
      kind: 'url',
      url: 'https://www.tube8.com/example/video/123/',
    }),
    'youtube-extractor',
  );
  assert.equal(
    classifyMediaRuntimePath('png-to-webp', {
      kind: 'url',
      url: 'https://cdn.example.test/image.png',
    }),
    'other',
  );
});

test('LOCAL Tool Factory refuses runtime acquisition before touching D1', async () => {
  let prepared = false;
  const database: ToolRuntimeObservationDatabase = {
    prepare() {
      prepared = true;
      throw new Error('LOCAL must not query D1');
    },
  };

  const result = await loadToolRuntimeObservations(database, {
    environment: 'LOCAL',
    sourceOrigin: 'http://127.0.0.1:3000',
    toolIds: ['audio-to-text'],
    now: new Date('2026-08-13T00:00:00.000Z'),
  });

  assert.equal(prepared, false);
  assert.deepEqual(result, {
    environment: 'LOCAL',
    state: 'unavailable',
    reason:
      'Runtime observations are queried only from the private DEV/STAGING D1 binding.',
    tools: [],
  });
});

test('DEV/STAGING reads one bounded completed-run window and keeps materially different paths separate', async () => {
  let query = '';
  let bindings: unknown[] = [];
  const database = {
    prepare(sql: string) {
      query = sql;
      return {
        bind(...values: unknown[]) {
          bindings = values;
          return this;
        },
        async all() {
          return {
            results: [
              {
                toolId: 'audio-to-text',
                status: 'succeeded',
                startedAt: '2026-08-12T23:50:00.000Z',
                errorCode: null,
                metadata: JSON.stringify({
                  runtimePath: 'upload',
                  ip: 'secret',
                }),
              },
              {
                toolId: 'audio-to-text',
                status: 'failed',
                startedAt: '2026-08-12T23:40:00.000Z',
                errorCode: 'https://secret.example/token',
                metadata: JSON.stringify({ runtimePath: 'direct-url' }),
              },
              {
                toolId: 'audio-to-text',
                status: 'failed',
                startedAt: '2026-08-12T23:30:00.000Z',
                errorCode: 'secret-token-123',
                metadata: JSON.stringify({ source: 'url' }),
              },
              {
                toolId: 'missing-tool',
                status: 'succeeded',
                startedAt: '2026-08-12T23:20:00.000Z',
                errorCode: null,
                metadata: null,
              },
            ],
          };
        },
      };
    },
  } satisfies ToolRuntimeObservationDatabase;

  const result = await loadToolRuntimeObservations(database, {
    environment: 'DEV/STAGING',
    sourceOrigin:
      'https://tools-serp-co-wayfinder-preview.serpcompany.workers.dev',
    toolIds: ['audio-to-text'],
    now: new Date('2026-08-13T00:00:00.000Z'),
  });

  assert.match(query, /^\s*SELECT\b/);
  assert.doesNotMatch(
    query,
    /\b(?:INSERT|UPDATE|DELETE|REPLACE|UPSERT|DROP|ALTER|CREATE|PRAGMA)\b/i,
  );
  assert.match(query, /status IN \('succeeded', 'failed'\)/);
  assert.match(query, /started_at >= \?/);
  assert.match(query, /LIMIT \?/);
  assert.deepEqual(bindings, ['2026-08-12T00:00:00.000Z', 500]);
  assert.equal(result.state, 'loaded');
  if (result.state !== 'loaded') return;
  assert.deepEqual(result.source, {
    authority: 'DEV/STAGING D1 tool_runs',
    windowStartedAt: '2026-08-12T00:00:00.000Z',
    windowEndedAt: '2026-08-13T00:00:00.000Z',
    rowLimit: 500,
    rowsRead: 4,
    freshnessThresholdMinutes: 60,
  });
  assert.equal(result.tools.length, 1);
  const tool = result.tools[0];
  assert.equal(tool?.toolId, 'audio-to-text');
  assert.deepEqual(
    tool?.paths.map((path) => [path.path, path.state]),
    [
      ['upload', 'observed'],
      ['direct-url', 'observed'],
      ['youtube-extractor', 'no-observations'],
      ['other', 'no-observations'],
      ['unclassified-url', 'observed'],
    ],
  );
  assert.deepEqual(tool?.paths[0], {
    path: 'upload',
    label: 'Upload',
    state: 'observed',
    environment: 'DEV/STAGING',
    windowStartedAt: '2026-08-12T00:00:00.000Z',
    windowEndedAt: '2026-08-13T00:00:00.000Z',
    sampleSize: 1,
    lastObservedAt: '2026-08-12T23:50:00.000Z',
    lastResult: 'succeeded',
    lastErrorClassifier: null,
    freshness: 'fresh',
    ageMinutes: 10,
  });
  assert.equal(
    tool?.paths[1]?.state === 'observed'
      ? tool.paths[1].lastErrorClassifier
      : null,
    'unclassified-failure',
  );
  assert.deepEqual(tool?.paths[2], {
    path: 'youtube-extractor',
    label: 'YouTube or extractor',
    state: 'no-observations',
    environment: 'DEV/STAGING',
    windowStartedAt: '2026-08-12T00:00:00.000Z',
    windowEndedAt: '2026-08-13T00:00:00.000Z',
    sampleSize: 0,
    reason:
      'No classified YouTube or extractor runs were present in the bounded DEV/STAGING window.',
  });
  assert.deepEqual(tool?.paths[4], {
    path: 'unclassified-url',
    label: 'Older unclassified link',
    state: 'observed',
    environment: 'DEV/STAGING',
    windowStartedAt: '2026-08-12T00:00:00.000Z',
    windowEndedAt: '2026-08-13T00:00:00.000Z',
    sampleSize: 1,
    lastObservedAt: '2026-08-12T23:30:00.000Z',
    lastResult: 'failed',
    lastErrorClassifier: 'unclassified-failure',
    freshness: 'fresh',
    ageMinutes: 30,
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|https:\/\//);
});

test('a production origin cannot query D1 even when environment labels are misconfigured', async () => {
  let prepared = false;
  const database: ToolRuntimeObservationDatabase = {
    prepare() {
      prepared = true;
      throw new Error('production binding must remain untouched');
    },
  };

  const result = await loadToolRuntimeObservations(database, {
    environment: 'DEV/STAGING',
    sourceOrigin: 'https://tools.serp.co',
    toolIds: ['audio-to-text'],
    now: new Date('2026-08-13T00:00:00.000Z'),
  });

  assert.equal(prepared, false);
  assert.deepEqual(result, {
    environment: 'DEV/STAGING',
    state: 'unavailable',
    reason:
      'Runtime observations require the isolated DEV/STAGING Worker origin; no database was queried.',
    tools: [],
  });
});

test('missing or unreadable DEV/STAGING sources expose a safe unavailable reason without data', async () => {
  const request = {
    environment: 'DEV/STAGING' as const,
    sourceOrigin:
      'https://tools-serp-co-wayfinder-preview.serpcompany.workers.dev',
    toolIds: ['audio-to-text'],
    now: new Date('2026-08-13T00:00:00.000Z'),
  };

  assert.deepEqual(await loadToolRuntimeObservations(null, request), {
    environment: 'DEV/STAGING',
    state: 'unavailable',
    reason: 'The private DEV/STAGING D1 binding is unavailable.',
    tools: [],
  });

  const unavailable = await loadToolRuntimeObservations(
    {
      prepare() {
        return {
          bind() {
            return this;
          },
          async all() {
            throw new Error(
              'D1_ERROR: no such table tool_runs; private detail',
            );
          },
        };
      },
    },
    request,
  );
  assert.deepEqual(unavailable, {
    environment: 'DEV/STAGING',
    state: 'unavailable',
    reason:
      'The private DEV/STAGING runtime source could not be read. Verify its binding and migrations.',
    tools: [],
  });
  assert.doesNotMatch(
    JSON.stringify(unavailable),
    /D1_ERROR|tool_runs|private detail/,
  );
});

test('bounded empty data says no observations while stale results remain time-bound evidence', async () => {
  const database: ToolRuntimeObservationDatabase = {
    prepare() {
      return {
        bind() {
          return this;
        },
        async all() {
          return {
            results: [
              {
                toolId: 'audio-to-text',
                status: 'failed',
                startedAt: '2026-08-12T01:00:00.000Z',
                errorCode: 'workflow_failed',
                metadata: JSON.stringify({ runtimePath: 'upload' }),
              },
            ],
          };
        },
      };
    },
  };
  const result = await loadToolRuntimeObservations(database, {
    environment: 'DEV/STAGING',
    sourceOrigin:
      'https://tools-serp-co-wayfinder-preview.serpcompany.workers.dev',
    toolIds: ['audio-to-text', 'png-to-webp'],
    now: new Date('2026-08-13T00:00:00.000Z'),
  });

  assert.equal(result.state, 'loaded');
  if (result.state !== 'loaded') return;
  const audio = result.tools.find((tool) => tool.toolId === 'audio-to-text');
  const upload = audio?.paths.find((path) => path.path === 'upload');
  assert.equal(upload?.state, 'observed');
  if (upload?.state === 'observed') {
    assert.equal(upload.freshness, 'stale');
    assert.equal(upload.ageMinutes, 1_380);
    assert.equal(upload.lastResult, 'failed');
    assert.equal(upload.lastErrorClassifier, 'processing-failed');
  }
  assert.equal(
    result.tools.some((tool) => tool.toolId === 'png-to-webp'),
    false,
  );
  assert.equal(JSON.stringify(result).includes('live'), false);
  assert.equal(JSON.stringify(result).includes('supported'), false);
});
