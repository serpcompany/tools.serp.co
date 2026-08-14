import assert from 'node:assert/strict';
import test from 'node:test';

import { toolJourneys } from './tool-journeys.ts';

test('Audio-to-Text exposes upload, direct URL, and extractor journeys separately', () => {
  const journeys = toolJourneys.getByToolId('audio-to-text');

  assert.deepEqual(
    journeys.map((journey) => ({
      id: journey.id,
      input: journey.input,
      requiredEnvironment: journey.requiredEnvironment,
      fixture: journey.fixture,
    })),
    [
      {
        id: 'audio-to-text:upload',
        input: { kind: 'file', runtimePath: 'upload' },
        requiredEnvironment: 'browser',
        fixture: {
          kind: 'tool-fixture',
          reference: 'fixtures/transcription-speech.mp3',
        },
      },
      {
        id: 'audio-to-text:direct-url',
        input: { kind: 'direct-url', runtimePath: 'direct-url' },
        requiredEnvironment: 'preview',
        fixture: {
          kind: 'direct-url-fixture',
          reference: 'fixtures/transcription-speech.mp3',
        },
      },
      {
        id: 'audio-to-text:extractor-url',
        input: { kind: 'extractor-url', runtimePath: 'youtube-extractor' },
        requiredEnvironment: 'preview',
        fixture: {
          kind: 'maintainer-url',
          reference: 'https://www.youtube.com/watch?v=3Is2P90qVa0',
        },
      },
    ],
  );
  assert.equal(
    journeys[2]?.promisedOutcome,
    'Fail closed with a plain unsupported explanation and no delivery.',
  );
  assert.equal(
    journeys[2]?.semanticInvariant.id,
    'truthful-unsupported-terminal',
  );
});

test('every active Tool has immutable, unique journey identities', () => {
  assert.equal(toolJourneys.tools.length, 2_807);
  assert.equal(toolJourneys.all.length, 3_115);
  assert.equal(
    new Set(toolJourneys.tools.map((entry) => entry.toolId)).size,
    2_807,
  );
  assert.equal(
    new Set(toolJourneys.all.map((journey) => journey.id)).size,
    3_115,
  );
  assert.ok(toolJourneys.tools.every((entry) => entry.journeys.length > 0));

  const generic = toolJourneys.getByToolId('png-to-webp');
  assert.equal(generic[0]?.id, 'png-to-webp:upload');
  assert.equal(generic[0]?.fixture.reference, 'formats/png');
  assert.equal(generic[0]?.semanticInvariant.id, 'generic-file-exact-output');

  const svgCompression = toolJourneys.getByToolId('compress-svg');
  assert.deepEqual(svgCompression, [
    {
      id: 'compress-svg:upload',
      toolId: 'compress-svg',
      input: { kind: 'file', runtimePath: 'upload' },
      promisedOutcome:
        'Produce semantically valid svg output for the compress operation.',
      requiredEnvironment: 'browser',
      fixture: { kind: 'format-fixture', reference: 'formats/svg' },
      semanticInvariant: {
        id: 'inert-svg-render-equivalence',
        sourceNeeded: null,
      },
    },
  ]);

  const placeholder = toolJourneys.getByToolId('audio-editor');
  assert.equal(placeholder[0]?.input.kind, 'unknown');
  assert.equal(placeholder[0]?.requiredEnvironment, 'unknown');
  assert.match(placeholder[0]?.fixture.sourceNeeded ?? '', /renderer/i);

  assert.throws(() => {
    (generic as unknown as ToolJourneyMutation[]).push(
      {} as ToolJourneyMutation,
    );
  }, TypeError);
});

type ToolJourneyMutation = { id: string };

test('runtime input resolution returns the exact declared journey or explicit unknown', () => {
  assert.equal(
    toolJourneys.resolveInput('audio-to-text', { kind: 'file' })?.id,
    'audio-to-text:upload',
  );
  assert.equal(
    toolJourneys.resolveInput('audio-to-text', {
      kind: 'url',
      url: 'https://media.example/speech.mp3',
    })?.id,
    'audio-to-text:direct-url',
  );
  assert.equal(
    toolJourneys.resolveInput('audio-to-text', {
      kind: 'url',
      url: 'https://www.youtube.com/watch?v=3Is2P90qVa0',
    })?.id,
    'audio-to-text:extractor-url',
  );
  assert.equal(
    toolJourneys.resolveInput('png-to-webp', {
      kind: 'url',
      url: 'https://media.example/image.png',
    }),
    null,
  );
});
