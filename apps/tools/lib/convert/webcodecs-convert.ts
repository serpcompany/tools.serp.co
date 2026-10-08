// Runs the steps webcodecs.ts plans for an AV1 or HEVC Tool. Loaded only when
// one runs. Mediabunny is imported by name so the bundler keeps only what the
// conversion uses.

import {
  BufferSource,
  BufferTarget,
  Conversion,
  Input,
  MATROSKA,
  MkvOutputFormat,
  Output,
  Quality,
  WEBM,
  WebMOutputFormat,
  canDecodeVideo,
  canEncodeVideo,
  getFirstEncodableVideoCodec,
} from "mediabunny";

import { FAST_VIDEO_FPS, FAST_VIDEO_WIDTH, convertVideo, runFFmpeg } from "./video.ts";
import {
  type BrowserCodec,
  type CodecAction,
  codecUnsupportedError,
  ffmpegStepArgs,
  planSteps,
} from "./webcodecs.ts";

// The size and frame rate of FFmpeg's other video outputs.
const SIZES = { width: FAST_VIDEO_WIDTH, frameRate: FAST_VIDEO_FPS };

export async function convertWithWebCodecs(
  buffer: ArrayBuffer,
  from: string,
  to: string,
  onProgress?: (percent: number) => void,
): Promise<ArrayBuffer> {
  const source = from.toLowerCase();
  const target = to.toLowerCase();
  const encodes: BrowserCodec | null = target === "av1" || target === "hevc" ? target : null;
  const unsupported = (action: CodecAction, codec: BrowserCodec) => codecUnsupportedError(action, codec, from, to);

  // Asked before FFmpeg loads, so an unsupported browser hears at once. The
  // real size is checked again when each browser step starts.
  const probe = { width: FAST_VIDEO_WIDTH, height: 240 };
  if (source === "av1" && !(await canDecodeVideo("av1"))) throw unsupported("decode", "av1");
  if (encodes && !(await canEncodeVideo(encodes, probe))) throw unsupported("encode", encodes);
  const handOffCodec = source === "av1" ? await getFirstEncodableVideoCodec(["vp8", "vp9"], probe) : null;
  if (source === "av1" && !handOffCodec) throw unsupported("decode", "av1");

  // A step the browser can't run names the codec the Tool is about.
  const browserStep = async (data: ArrayBuffer, job: "hand-off" | "encode", progress: (ratio: number) => void) => {
    const [action, codec]: [CodecAction, BrowserCodec] = job === "encode" ? ["encode", encodes!] : ["decode", "av1"];
    const input = new Input({ source: new BufferSource(data), formats: [MATROSKA, WEBM] });
    const output = new Output({
      format: job === "encode" ? new MkvOutputFormat() : new WebMOutputFormat(),
      target: new BufferTarget(),
    });
    try {
      const conversion = await Conversion.init({
        input,
        output,
        // No resizing here: FFmpeg scales. A bitrate, not a quantizer:
        // Chrome 143 caps the AV1 quantizer at 63 of Mediabunny's 255, which
        // gave every frame its worst quality.
        video:
          job === "encode"
            ? { codec: encodes!, quality: new Quality({ quality: "high", preferBitrate: true }), forceTranscode: true }
            : { codec: handOffCodec!, quality: new Quality("very-high"), forceTranscode: true },
        // Elementary streams hold no audio; a hand-off keeps any audio the
        // .av1 file had.
        audio: job === "encode" ? { discard: true } : {},
        showWarnings: false,
      });
      if (!conversion.utilizedTracks.some((track) => track.isVideoTrack())) {
        const dropped = conversion.discardedTracks.find((entry) => entry.track.isVideoTrack());
        if (dropped?.reason === "undecodable_source_codec" || dropped?.reason === "no_encodable_target_codec") {
          throw unsupported(action, codec);
        }
        throw new Error(`No video track to convert${dropped ? ` (${dropped.reason})` : ""}`);
      }
      conversion.onProgress = (ratio) => progress(ratio);
      await conversion.execute();
    } finally {
      input.dispose();
    }
    if (!output.target.buffer) throw new Error("The browser's encoder wrote nothing");
    return output.target.buffer;
  };

  // One progress bar, an equal share per step.
  const steps = planSteps(from, to);
  let data = buffer;
  let name = `input.${source}`;
  for (const [index, step] of steps.entries()) {
    const progress = (ratio: number) =>
      onProgress?.(Math.round(((index + Math.min(1, Math.max(0, ratio))) / steps.length) * 100));
    if (step.run === "ffmpeg") {
      data = await runFFmpeg({ name, data }, ffmpegStepArgs(step.args, SIZES), step.output, progress);
      name = step.output;
    } else if (step.run === "browser") {
      data = await browserStep(data, step.job, progress);
      name = step.job === "encode" ? "encoded.mkv" : "handoff.webm";
    } else {
      data = await convertVideo(data, "webm", target, { onProgress: ({ ratio }) => progress(ratio) });
    }
  }
  return data;
}
