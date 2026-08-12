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
import { getMediaWorkflowAdapterRegistration } from './media-workflow/adapter-registration.ts';
import { selectToolRenderer } from './tool-renderer.ts';

function mapped(toolId) {
  const provenance = getToolExecutionProvenance(toolId);
  assert.equal(provenance.kind, 'mapped', toolId);
  return provenance;
}

test('conversion and compression provenance follows actual dispatch selectors', () => {
  assert.equal(resolveConversionDispatch('cr2', 'jpg').kind, 'server-image');
  assert.deepEqual(mapped('cr2-to-jpg').executionProfiles, ['server-executed']);

  assert.equal(resolveConversionDispatch('3g2', 'mp4').kind, 'adaptive-video');
  assert.equal(
    resolveConversionDispatch('mp4', 'm4a').engineIds[0],
    'adaptive-media-conversion',
  );
  assert.deepEqual(mapped('3g2-to-mp4').executionProfiles, [
    'client-only',
    'server-assisted',
    'server-executed',
  ]);

  assert.deepEqual(mapped('compress-jpg').executionProfiles, ['client-only']);
  assert.deepEqual(mapped('compress-pdf').executionProfiles, [
    'server-executed',
  ]);
  assert.deepEqual(resolveConversionDispatch('heic', 'pdf').engineIds, [
    'browser-raster-worker',
  ]);
  assert.deepEqual(resolveConversionDispatch('cr2', 'pdf').engineIds, [
    'browser-raster-with-server-image-decode',
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

  const convertWorkerSource = readFileSync(
    new URL('../workers/convert.worker.js', import.meta.url),
    'utf8',
  );
  const decodeSource = readFileSync(
    new URL('./convert/decode.ts', import.meta.url),
    'utf8',
  );
  const encodeSource = readFileSync(
    new URL('./convert/encode.ts', import.meta.url),
    'utf8',
  );
  const heifSource = readFileSync(
    new URL('./convert/heif.ts', import.meta.url),
    'utf8',
  );
  const compressionWorkerSource = readFileSync(
    new URL('../workers/compress.worker.js', import.meta.url),
    'utf8',
  );
  const imageConvertNativeSource = readFileSync(
    new URL('../app/api/image-convert/native.ts', import.meta.url),
    'utf8',
  );
  assert.match(convertWorkerSource, /decodeToRGBA/);
  assert.match(convertWorkerSource, /encodeFromRGBA/);
  assert.match(decodeSource, /ImageDecoder/);
  assert.match(decodeSource, /createImageBitmap/);
  assert.match(decodeSource, /decodeHeifToRGBA/);
  assert.match(heifSource, /libheif/);
  assert.match(encodeSource, /OffscreenCanvas/);
  assert.match(encodeSource, /convertToBlob/);
  assert.match(encodeSource, /import\("pdf-lib"\)/);
  assert.match(
    workerClientSource,
    /convertImageViaApi\(\{ \.\.\.args, to: ['"]png['"] \}\)/,
  );
  assert.match(workerClientSource, /convertRasterOnMainThread\(\{/);
  assert.match(workerClientSource, /from: ['"]png['"]/);
  assert.match(workerClientSource, /import\(['"]upng-js['"]\)/);
  assert.match(compressionWorkerSource, /@jsquash\/oxipng/);
  assert.match(compressionWorkerSource, /@jsquash\/jpeg/);
  assert.match(imageConvertNativeSource, /convertWithMagickWasm/);
  assert.deepEqual(
    executionProvenance.getEngine('browser-raster-worker')?.implementation,
    {
      class: 'hybrid',
      identity:
        'libheif, WebCodecs ImageDecoder, createImageBitmap, Canvas 2D, and pdf-lib',
      rationale:
        'Repository dispatch uses libheif for HEIC/HEIF inputs, browser image primitives for other raster inputs, Canvas for raster encoding, and pdf-lib for PDF outputs.',
    },
  );
  assert.deepEqual(
    executionProvenance.getEngine('browser-raster-with-server-image-decode')
      ?.implementation,
    {
      class: 'hybrid',
      identity:
        'repository server image decoder, WebCodecs ImageDecoder, createImageBitmap, Canvas 2D, and pdf-lib',
      rationale:
        'The repository server emits PNG; browser image and Canvas primitives produce raster outputs, while pdf-lib packages PDF outputs.',
    },
  );
  assert.deepEqual(
    executionProvenance.getEngine('browser-image-compression-worker')
      ?.implementation,
    {
      class: 'hybrid',
      identity:
        '@jsquash image codecs with UPNG.js and browser Canvas fallbacks',
      rationale:
        'The compression worker uses JSquash; repository fallbacks use UPNG.js for PNG and platform image/Canvas primitives for other browser images.',
    },
  );
});

test('the exact WebM browser family exposes client-only FFmpeg provenance', () => {
  for (const toolId of [
    'compress-webm',
    'webm-to-m4a',
    'webm-to-mp3',
    'webm-to-mp4',
  ]) {
    assert.deepEqual(mapped(toolId).executionProfiles, ['client-only'], toolId);
  }
  for (const output of ['m4a', 'mp3', 'mp4']) {
    assert.deepEqual(resolveConversionDispatch('webm', output), {
      kind: 'browser-webm-ffmpeg',
      engineIds: ['browser-ffmpeg-wasm'],
    });
  }
  assert.equal(resolveConversionDispatch('webm', 'mov').kind, 'adaptive-video');
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
  const browserMediaWorkflowSource = readFileSync(
    new URL('../lib/media-workflow/transcription-browser.ts', import.meta.url),
    'utf8',
  );
  const mediaEndpointSource = readFileSync(
    new URL('../lib/media-workflow/media-endpoint.ts', import.meta.url),
    'utf8',
  );
  assert.match(downloaderSource, /createBrowserMediaWorkflow/);
  assert.match(mediaEndpointSource, /getDownloaderMediaFetchEndpoint/);
  assert.match(mediaEndpointSource, /getMediaFetchEndpoint/);
  assert.match(transcriptionSource, /handleFiles/);
  assert.match(browserMediaWorkflowSource, /transcribe\.worker/);
});

test('specialized and table Tools expose explicit browser-owned engines', () => {
  assert.deepEqual(mapped('csv-to-sql').engineIds, ['browser-table-converter']);
  assert.deepEqual(mapped('character-counter').engineIds, [
    'browser-character-counter',
  ]);
  assert.deepEqual(mapped('html-to-markdown').executionProfiles, [
    'client-only',
  ]);
  const batchEngineId = mapped('batch-compress-png').engineIds[0];
  assert.deepEqual(
    executionProvenance.getEngine(batchEngineId)?.implementation,
    {
      class: 'library',
      identity: '@jsquash/oxipng and @zip.js/zip.js',
    },
  );

  const tableSource = readFileSync(
    new URL('./table-tool-processors.ts', import.meta.url),
    'utf8',
  );
  assert.match(tableSource, /function parseTableInput/);
  assert.match(tableSource, /function serializeTable/);
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
      identity:
        'libheif, WebCodecs ImageDecoder, createImageBitmap, Canvas 2D, and pdf-lib',
      rationale:
        'Repository dispatch uses libheif for HEIC/HEIF inputs, browser image primitives for other raster inputs, Canvas for raster encoding, and pdf-lib for PDF outputs.',
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
    kind: 'wired',
    toolId: 'png-to-jpg',
    adapterId: 'generic-conversion',
  });
  assert.deepEqual(getToolProcessorAvailability('markdown-to-rdataframe'), {
    kind: 'unwired',
    toolId: 'markdown-to-rdataframe',
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

test('every active shared-renderer downloader is explicitly wired to the streamed workflow', () => {
  const eligibleDownloaders = toolCatalog.activeTools.filter(
    (tool) => selectToolRenderer(tool) === 'downloader',
  );

  assert.equal(eligibleDownloaders.length, 292);
  for (const tool of eligibleDownloaders) {
    assert.deepEqual(getMediaWorkflowAdapterRegistration(tool.id), {
      toolId: tool.id,
      family: 'downloader',
      adapterId: 'streamed-media-workflow',
    });
    assert.deepEqual(getToolProcessorAvailability(tool.id), {
      kind: 'wired',
      toolId: tool.id,
      adapterId: 'streamed-media-workflow',
    });
  }
});
