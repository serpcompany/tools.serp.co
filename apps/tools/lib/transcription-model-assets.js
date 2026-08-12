export const TRANSCRIPTION_MODEL_ID = "Xenova/whisper-tiny";
export const TRANSCRIPTION_MODEL_REVISION =
  "5332fcc35e32a33b86612b9a57a89be7906102b1";
export const TRANSCRIPTION_MODEL_ROUTE = "/vendor/models/whisper-tiny";
export const TRANSCRIPTION_MODEL_PROVENANCE = Object.freeze({
  source: "https://huggingface.co/Xenova/whisper-tiny",
  sourceRevision: TRANSCRIPTION_MODEL_REVISION,
  upstreamModel: "https://huggingface.co/openai/whisper-tiny",
  declaredLicense: "Apache-2.0",
  licenseDeclaration:
    `https://huggingface.co/Xenova/whisper-tiny/blob/${TRANSCRIPTION_MODEL_REVISION}/README.md`,
});
export const TRANSCRIPTION_MODEL_FILES = Object.freeze([
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "preprocessor_config.json",
  "generation_config.json",
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx",
]);
export const TRANSCRIPTION_MODEL_BYTES = Object.freeze({
  "config.json": 2248,
  "tokenizer.json": 2480466,
  "tokenizer_config.json": 282683,
  "preprocessor_config.json": 339,
  "generation_config.json": 3716,
  "onnx/encoder_model_quantized.onnx": 10124910,
  "onnx/decoder_model_merged_quantized.onnx": 30727765,
});

export function transcriptionModelAssetPath(file) {
  return `${TRANSCRIPTION_MODEL_ROUTE}/${TRANSCRIPTION_MODEL_REVISION}/${file}`;
}

export function transcriptionModelUpstreamUrl(file) {
  return `https://huggingface.co/${TRANSCRIPTION_MODEL_ID}/resolve/${TRANSCRIPTION_MODEL_REVISION}/${file}`;
}
