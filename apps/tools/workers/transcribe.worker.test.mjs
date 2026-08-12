import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  TRANSCRIPTION_MODEL_FILES,
  TRANSCRIPTION_MODEL_PROVENANCE,
  TRANSCRIPTION_MODEL_REVISION,
} from '../lib/transcription-model-assets.js';

test('the production transcription worker preserves its external module import', async () => {
  const source = await readFile(
    new URL('./transcribe.worker.js', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /import\(\/\* webpackIgnore: true \*\/ TRANSFORMERS_URL\)/,
  );
  assert.match(source, /module\.env\.remoteHost = self\.location\.origin/);
  assert.match(source, /module\.env\.remotePathTemplate/);
  assert.match(source, /revision:\s*TRANSCRIPTION_MODEL_REVISION/);
  assert.equal(
    TRANSCRIPTION_MODEL_REVISION,
    '5332fcc35e32a33b86612b9a57a89be7906102b1',
  );
  assert.deepEqual(TRANSCRIPTION_MODEL_PROVENANCE, {
    source: 'https://huggingface.co/Xenova/whisper-tiny',
    sourceRevision: TRANSCRIPTION_MODEL_REVISION,
    upstreamModel: 'https://huggingface.co/openai/whisper-tiny',
    declaredLicense: 'Apache-2.0',
    licenseDeclaration:
      `https://huggingface.co/Xenova/whisper-tiny/blob/${TRANSCRIPTION_MODEL_REVISION}/README.md`,
  });
  assert.deepEqual(TRANSCRIPTION_MODEL_FILES, [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'preprocessor_config.json',
    'generation_config.json',
    'onnx/encoder_model_quantized.onnx',
    'onnx/decoder_model_merged_quantized.onnx',
  ]);
});
