import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { toolCatalog } from '../../../packages/app-core/src/lib/tool-catalog.ts';
import { resolveCompressionDispatch } from './compression-utils.ts';
import { resolveConversionDispatch } from './convert/conversion-dispatch.ts';
import {
  executionProvenance,
  getToolExecutionProvenance,
} from './tool-execution-provenance.ts';
import { getToolProcessorAvailability } from './tool-processor-registry.ts';

function mapped(toolId) {
  const provenance = getToolExecutionProvenance(toolId);
  assert.equal(provenance.kind, 'mapped', toolId);
  return provenance;
}

test('conversion and compression provenance follows actual dispatch selectors', () => {
  assert.equal(resolveConversionDispatch('cr2', 'jpg').kind, 'server-image');
  assert.deepEqual(mapped('cr2-to-jpg').executionProfiles, ['server-executed']);

  assert.equal(resolveConversionDispatch('3g2', 'mp4').kind, 'adaptive-video');
  assert.deepEqual(mapped('3g2-to-mp4').executionProfiles, [
    'client-only',
    'server-executed',
  ]);

  assert.deepEqual(mapped('compress-jpg').executionProfiles, ['client-only']);
  assert.deepEqual(mapped('compress-pdf').executionProfiles, [
    'server-executed',
  ]);
  assert.deepEqual(
    [
      ['ai', 'svg'],
      ['pdf', 'png'],
      ['cr2', 'jpg'],
      ['cr2', 'avif'],
      ['heic', 'jpg'],
      ['3g2', 'mp4'],
      ['png', 'jpg'],
    ].map(([from, to]) => resolveConversionDispatch(from, to).kind),
    [
      'browser-pdf-pages',
      'browser-pdf-pages',
      'server-image',
      'server-assisted-image',
      'browser-raster',
      'adaptive-video',
      'browser-raster',
    ],
  );
  assert.deepEqual(
    ['jpg', 'gif', 'pdf', 'mp4'].map(
      (format) => resolveCompressionDispatch(format).target,
    ),
    ['image-worker', 'image-server', 'pdf', 'video'],
  );

  const workerClientSource = readFileSync(
    new URL('./convert/workerClient.ts', import.meta.url),
    'utf8',
  );
  assert.match(workerClientSource, /resolveConversionDispatch/);
  assert.match(workerClientSource, /resolveCompressionDispatch/);
});

test('downloader and browser-with-fetch support keep distinct profiles', () => {
  const downloader = mapped('download-thisvid-videos');
  assert.deepEqual(downloader.executionProfiles, ['server-executed']);
  assert.deepEqual(downloader.engineIds, ['server-media-fetch']);

  const transcription = mapped('audio-to-text');
  assert.deepEqual(transcription.executionProfiles, [
    'client-only',
    'server-assisted',
  ]);
  assert.deepEqual(transcription.engineIds, [
    'browser-transformers-transcription',
    'server-media-fetch-for-browser-transcription',
  ]);

  const downloaderSource = readFileSync(
    new URL('../components/VideoDownloaderTool.tsx', import.meta.url),
    'utf8',
  );
  const transcriptionSource = readFileSync(
    new URL('../components/TranscribeTool.tsx', import.meta.url),
    'utf8',
  );
  assert.match(downloaderSource, /getDownloaderMediaFetchEndpoint/);
  assert.match(transcriptionSource, /getMediaFetchEndpoint/);
  assert.match(transcriptionSource, /handleFiles/);
  assert.match(transcriptionSource, /transcribe\.worker/);
});

test('specialized and table Tools expose explicit browser-owned engines', () => {
  assert.deepEqual(mapped('csv-to-sql').engineIds, ['browser-table-converter']);
  assert.deepEqual(mapped('character-counter').engineIds, [
    'browser-character-counter',
  ]);
  assert.deepEqual(mapped('html-to-markdown').executionProfiles, [
    'client-only',
  ]);

  const tableSource = readFileSync(
    new URL('../components/table-convert/convert.ts', import.meta.url),
    'utf8',
  );
  assert.match(tableSource, /export function parseInput/);
  assert.match(tableSource, /export function serializeOutput/);
});

test('unknown provenance remains first-class and separate from health', () => {
  const unknown = getToolExecutionProvenance('video-editor');
  assert.deepEqual(unknown, {
    kind: 'unknown',
    toolId: 'video-editor',
    mappingConfidence: 'unknown',
    reason: 'No maintained execution mapping exists for this Tool renderer.',
    sourceNeeded:
      'Trace the active renderer to the function that performs its core operation.',
  });
  assert.equal('status' in unknown, false);
  assert.equal('isHealthy' in unknown, false);
});

test('read-only provenance is joinable by every canonical Tool id', () => {
  for (const tool of toolCatalog.tools) {
    assert.equal(getToolExecutionProvenance(tool.id).toolId, tool.id);
  }

  const rasterEngine = executionProvenance.getEngine('browser-raster-worker');
  assert.deepEqual(rasterEngine, {
    id: 'browser-raster-worker',
    capability: 'raster-conversion',
    owner: 'apps/tools/lib/convert/workerClient.ts',
    processingLocation: 'browser',
    executionProfile: 'client-only',
    implementation: {
      class: 'hybrid',
      identity: '@jsquash codecs, UPNG.js, and @imagemagick/magick-wasm',
      rationale:
        'Repository dispatch selects trusted codecs without implementing image codecs.',
    },
  });
  assert.equal(executionProvenance.getEngine('toString'), undefined);
  assert.equal(executionProvenance.getEngine('__proto__'), undefined);
  assert.throws(() => {
    executionProvenance.engines.push(rasterEngine);
  }, TypeError);
  assert.throws(() => {
    rasterEngine.owner = 'changed';
  }, TypeError);

  for (const engine of executionProvenance.engines) {
    assert.equal(existsSync(engine.owner), true, engine.owner);
    assert.notEqual(engine.implementation.identity.trim(), '', engine.id);
    if (
      engine.implementation.class === 'hybrid' ||
      engine.implementation.class === 'repository-authored'
    ) {
      assert.notEqual(engine.implementation.rationale.trim(), '', engine.id);
    }
  }
});

test('processor availability stays distinct from inferred provenance and joins by Tool id', () => {
  for (const tool of toolCatalog.tools) {
    assert.equal(getToolProcessorAvailability(tool.id).toolId, tool.id);
  }

  assert.deepEqual(getToolProcessorAvailability('png-to-jpg'), {
    kind: 'unwired',
    toolId: 'png-to-jpg',
    reason:
      'Execution provenance is known, but no processor adapter is registered for the shared workflow.',
    sourceNeeded:
      'Register a processor adapter only when this Tool family migrates to the shared workflow.',
  });
  assert.deepEqual(getToolProcessorAvailability('video-editor'), {
    kind: 'unknown',
    toolId: 'video-editor',
    reason: 'No maintained execution mapping exists for this Tool renderer.',
    sourceNeeded:
      'Trace the active renderer to the function that performs its core operation.',
  });
  assert.equal('isActive' in getToolProcessorAvailability('png-to-jpg'), false);
  assert.equal('status' in getToolProcessorAvailability('png-to-jpg'), false);
});
