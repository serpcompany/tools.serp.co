import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildToolGithubWorkIndex,
  retainedToolGithubWorkLinks,
} from './tool-github-work-links.ts';

const memberships = [
  { toolId: 'audio-to-text', family: 'renderer:transcription' },
  { toolId: 'mp3-to-transcript', family: 'renderer:transcription' },
  { toolId: 'png-to-webp', family: 'generic-convert:browser-raster' },
] as const;

test('GitHub work resolves only through explicit Tool and exact family membership', () => {
  const index = buildToolGithubWorkIndex(
    [
      {
        kind: 'issue',
        number: 12,
        title: 'Exact Tool defect',
        state: 'closed',
        url: 'https://github.com/serpcompany/tools.serp.co/issues/12',
        scope: { kind: 'tools', toolIds: ['audio-to-text'] },
      },
      {
        kind: 'pull-request',
        number: 13,
        title: 'Family implementation',
        state: 'open',
        url: 'https://github.com/serpcompany/tools.serp.co/pull/13',
        scope: {
          kind: 'family',
          family: 'renderer:transcription',
          toolIds: ['audio-to-text', 'mp3-to-transcript'],
        },
      },
    ],
    memberships,
  );

  assert.deepEqual(
    index.getForTool('audio-to-text', 'renderer:transcription'),
    {
      tool: [
        {
          kind: 'issue',
          number: 12,
          title: 'Exact Tool defect',
          state: 'closed',
          stateLabel: 'Closed issue',
          url: 'https://github.com/serpcompany/tools.serp.co/issues/12',
        },
      ],
      family: [
        {
          kind: 'pull-request',
          number: 13,
          title: 'Family implementation',
          state: 'open',
          stateLabel: 'Open pull request',
          url: 'https://github.com/serpcompany/tools.serp.co/pull/13',
        },
      ],
    },
  );
  assert.deepEqual(
    index.getForTool('png-to-webp', 'generic-convert:browser-raster'),
    { tool: [], family: [] },
  );
});

test('family links fail closed when their exact Tool membership drifts', () => {
  assert.throws(
    () =>
      buildToolGithubWorkIndex(
        [
          {
            kind: 'issue',
            number: 82,
            title: 'Transcription work',
            state: 'closed',
            url: 'https://github.com/serpcompany/tools.serp.co/issues/82',
            scope: {
              kind: 'family',
              family: 'renderer:transcription',
              toolIds: ['audio-to-text'],
            },
          },
        ],
        memberships,
      ),
    /membership does not match/,
  );
});

test('retained links reject unknown Tools and noncanonical GitHub URLs', () => {
  assert.throws(
    () =>
      buildToolGithubWorkIndex(
        [
          {
            kind: 'issue',
            number: 97,
            title: 'Unknown Tool',
            state: 'open',
            url: 'https://github.com/serpcompany/tools.serp.co/issues/97',
            scope: { kind: 'tools', toolIds: ['missing-tool'] },
          },
        ],
        memberships,
      ),
    /unknown Tool/,
  );
  assert.throws(
    () =>
      buildToolGithubWorkIndex(
        [
          {
            kind: 'pull-request',
            number: 96,
            title: 'Wrong URL',
            state: 'open',
            url: 'https://example.test/pull/96',
            scope: { kind: 'tools', toolIds: ['audio-to-text'] },
          },
        ],
        memberships,
      ),
    /canonical repository URL/,
  );
});

test('retained GitHub work includes current and closed exact examples', () => {
  const states = new Set(retainedToolGithubWorkLinks.map((link) => link.state));
  const kinds = new Set(retainedToolGithubWorkLinks.map((link) => link.kind));
  assert.ok(states.has('open'));
  assert.ok(states.has('closed'));
  assert.ok(kinds.has('issue'));
  assert.ok(kinds.has('pull-request'));
});
