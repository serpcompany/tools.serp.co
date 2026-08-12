import assert from 'node:assert/strict';
import test from 'node:test';

import { presentToolRuntimeObservations } from './tool-runtime-observation-presentation.ts';
import type { ToolRuntimeObservationPortfolio } from './tool-runtime-observations.ts';

test('loaded staging evidence becomes human-first path cards without changing its meaning', () => {
  const portfolio: ToolRuntimeObservationPortfolio = {
    environment: 'DEV/STAGING',
    state: 'loaded',
    source: {
      authority: 'DEV/STAGING D1 tool_runs',
      windowStartedAt: '2026-08-12T00:00:00.000Z',
      windowEndedAt: '2026-08-13T00:00:00.000Z',
      rowLimit: 500,
      rowsRead: 8,
      freshnessThresholdMinutes: 60,
    },
    tools: [
      {
        toolId: 'audio-to-text',
        paths: [
          {
            path: 'upload',
            label: 'Upload',
            state: 'observed',
            environment: 'DEV/STAGING',
            windowStartedAt: '2026-08-12T00:00:00.000Z',
            windowEndedAt: '2026-08-13T00:00:00.000Z',
            sampleSize: 3,
            lastObservedAt: '2026-08-12T23:50:00.000Z',
            lastResult: 'failed',
            lastErrorCode: 'decode-failed',
            freshness: 'fresh',
            ageMinutes: 10,
          },
          {
            path: 'youtube-extractor',
            label: 'YouTube or extractor',
            state: 'no-observations',
            environment: 'DEV/STAGING',
            windowStartedAt: '2026-08-12T00:00:00.000Z',
            windowEndedAt: '2026-08-13T00:00:00.000Z',
            sampleSize: 0,
            reason: 'source-owned technical explanation',
          },
        ],
      },
    ],
  };

  assert.deepEqual(presentToolRuntimeObservations(portfolio, 'audio-to-text'), {
    state: 'loaded',
    heading: 'Recent staging activity',
    sampleSummary:
      'DEV/STAGING · 24-hour window · 8 of at most 500 portfolio rows read.',
    paths: [
      {
        label: 'Upload',
        state: 'observed',
        environment: 'DEV/STAGING',
        attempts: 3,
        latestResult: 'Failed · decode-failed',
        lastSeenAt: '2026-08-12T23:50:00.000Z',
        freshness: 'Fresh · 10 min ago',
      },
      {
        label: 'YouTube or extractor',
        state: 'no-observations',
        explanation:
          'No matching attempts appeared in this bounded sample. This does not mean the path had no usage outside the window or row cap.',
      },
    ],
    notice:
      'Runtime activity is time-bound evidence only. It does not change Catalog intent, implementation support, or test results.',
  });
});

test('missing and unavailable states do not turn absence into zero usage', () => {
  const unavailable: ToolRuntimeObservationPortfolio = {
    environment: 'DEV/STAGING',
    state: 'unavailable',
    reason: 'The private DEV/STAGING D1 binding is unavailable.',
    tools: [],
  };
  assert.deepEqual(presentToolRuntimeObservations(unavailable, 'alpha'), {
    state: 'unavailable',
    heading: 'Recent staging activity',
    title: "Couldn't load staging activity",
    explanation: 'The private DEV/STAGING D1 binding is unavailable.',
  });

  const empty: ToolRuntimeObservationPortfolio = {
    environment: 'DEV/STAGING',
    state: 'loaded',
    source: {
      authority: 'DEV/STAGING D1 tool_runs',
      windowStartedAt: '2026-08-12T00:00:00.000Z',
      windowEndedAt: '2026-08-13T00:00:00.000Z',
      rowLimit: 500,
      rowsRead: 500,
      freshnessThresholdMinutes: 60,
    },
    tools: [],
  };
  const view = presentToolRuntimeObservations(empty, 'alpha');
  assert.equal(view.state, 'empty');
  assert.match(view.explanation, /does not mean there was no usage outside/);
});
