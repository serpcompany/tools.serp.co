// AV1 and HEVC through the browser's own codecs (WebCodecs), driven by
// Mediabunny (issue #147). FFmpeg.wasm can't do these alone: its AV1 decoder
// only works with hardware acceleration, it has no AV1 encoder, and libx265
// doesn't finish in single-threaded wasm. FFmpeg still reads and writes every
// container, and does all the scaling, around the browser's steps:
//
// - From AV1: FFmpeg copies the .av1 stream (IVF or OBU) into Matroska, the
//   browser decodes it and hands FFmpeg VP8 in WebM, and FFmpeg converts that
//   like any other input (convertVideo).
// - To AV1 or HEVC: FFmpeg decodes the input to VP8 in WebM at the size and
//   frame rate of its other video outputs, the browser encodes that, and
//   FFmpeg writes the elementary stream the extension names: IVF for .av1
//   (what aomenc writes, and what our fixture is) and Annex B for .hevc.
//   Neither holds audio.
//
// AV1 to HEVC does both. Mediabunny and FFmpeg load only when one of these
// Tools runs. A browser without the codec gets a message, not a failure
// (owner decision).

import type { ToolRunMetadata } from "@serp-tools/tool-telemetry";

type BrowserCodec = "av1" | "hevc";
type CodecAction = "decode" | "encode";

// The telemetry code for a browser that lacks the codec. The run is handed
// off (to another browser), not failed.
export const CODEC_UNSUPPORTED = "codec_unsupported";

const CODEC_LABELS: Record<BrowserCodec, string> = { av1: "AV1", hevc: "HEVC" };

// Tools whose AV1 or HEVC step runs in the browser. HEVC input stays on
// FFmpeg, which decodes it in software.
export function usesWebCodecs(from: string, to: string): boolean {
  const target = to.toLowerCase();
  return from.toLowerCase() === "av1" || target === "av1" || target === "hevc";
}

export function codecUnsupportedMessage(action: CodecAction, codec: BrowserCodec): string {
  return `This browser can't ${action} ${CODEC_LABELS[codec]}. Try Chrome or Edge.`;
}

type UnsupportedError = Error & { telemetryCode: string; telemetryMetadata: ToolRunMetadata };

function unsupported(action: CodecAction, codec: BrowserCodec, from: string, to: string) {
  const error = new Error(codecUnsupportedMessage(action, codec)) as UnsupportedError;
  error.telemetryCode = CODEC_UNSUPPORTED;
  error.telemetryMetadata = { from, to, engine: "webcodecs", format: codec };
  return error;
}

// The FFmpeg and browser steps a Tool runs, in order.
export type Step =
  | { run: "ffmpeg"; args: "copy-av1" | "to-vp8" | "write-av1" | "write-hevc"; output: string }
  | { run: "browser"; job: "hand-off" | "encode" }
  | { run: "convertVideo" };

export function planSteps(from: string, to: string): Step[] {
  const target = to.toLowerCase();
  const steps: Step[] = [];
  if (from.toLowerCase() === "av1") {
    steps.push({ run: "ffmpeg", args: "copy-av1", output: "source.mkv" }, { run: "browser", job: "hand-off" });
    if (target !== "av1" && target !== "hevc") return [...steps, { run: "convertVideo" }];
  }
  return [
    ...steps,
    { run: "ffmpeg", args: "to-vp8", output: "source.webm" },
    { run: "browser", job: "encode" },
    { run: "ffmpeg", args: target === "av1" ? "write-av1" : "write-hevc", output: `output.${target}` },
  ];
}

// Arguments between FFmpeg's input and output names. VP8 at near-lossless
// quality is the hand-off both ways: FFmpeg encodes it fast and every browser
// with WebCodecs decodes it. Going to the browser it is converted to BT.601
// and tagged so. Untagged inputs, most of these legacy formats, are BT.601 to
// FFmpeg, so for them that changes nothing; left untagged, the browser would
// read them as BT.709 and shift their colours.
export function ffmpegStepArgs(
  step: "copy-av1" | "to-vp8" | "write-av1" | "write-hevc",
  { width, frameRate }: { width: number; frameRate: number },
): string[] {
  switch (step) {
    case "copy-av1":
      return ["-map", "0:v:0", "-map", "0:a:0?", "-c", "copy"];
    case "to-vp8":
      return [
        "-map", "0:v:0", "-an",
        "-vf", `fps=${frameRate},scale=${width}:-2:flags=fast_bilinear:out_color_matrix=bt601`,
        "-colorspace", "smpte170m", "-color_primaries", "smpte170m", "-color_trc", "smpte170m",
        "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8",
        "-crf", "4", "-b:v", "8M", "-auto-alt-ref", "0", "-pix_fmt", "yuv420p",
      ];
    case "write-av1":
      return ["-map", "0:v:0", "-c:v", "copy", "-f", "ivf"];
    case "write-hevc":
      // Annex B with the parameter sets in-band (the muxer doesn't add them
      // once another filter runs). A raw stream has no timestamps: the VUI
      // tick rate tells players the frame rate, which would otherwise be 25.
      return [
        "-map", "0:v:0", "-c:v", "copy",
        "-bsf:v", `hevc_mp4toannexb,hevc_metadata=tick_rate=${frameRate}`, "-f", "hevc",
      ];
  }
}

export async function convertWithWebCodecs(
  buffer: ArrayBuffer,
  from: string,
  to: string,
  onProgress?: (percent: number) => void,
): Promise<ArrayBuffer> {
  const source = from.toLowerCase();
  const target = to.toLowerCase();
  const encodes: BrowserCodec | null = target === "av1" || target === "hevc" ? target : null;
  const mb = await import("mediabunny");
  const video = await import("./video.ts");
  const sizes = { width: video.FAST_VIDEO_WIDTH, frameRate: video.FAST_VIDEO_FPS };

  // Asked before FFmpeg loads, so an unsupported browser hears at once. The
  // real size is checked again when each browser step starts.
  const probe = { width: video.FAST_VIDEO_WIDTH, height: 240 };
  if (source === "av1" && !(await mb.canDecodeVideo("av1"))) throw unsupported("decode", "av1", from, to);
  if (encodes && !(await mb.canEncodeVideo(encodes, probe))) throw unsupported("encode", encodes, from, to);
  const handOffCodec = source === "av1" ? await mb.getFirstEncodableVideoCodec(["vp8", "vp9"], probe) : null;
  if (source === "av1" && !handOffCodec) throw unsupported("decode", "av1", from, to);

  // A step the browser can't run names the codec the Tool is about.
  const browserStep = async (data: ArrayBuffer, job: "hand-off" | "encode", progress: (ratio: number) => void) => {
    const [action, codec]: [CodecAction, BrowserCodec] = job === "encode" ? ["encode", encodes!] : ["decode", "av1"];
    const input = new mb.Input({ source: new mb.BufferSource(data), formats: [mb.MATROSKA, mb.WEBM] });
    const output = new mb.Output({
      format: job === "encode" ? new mb.MkvOutputFormat() : new mb.WebMOutputFormat(),
      target: new mb.BufferTarget(),
    });
    try {
      const conversion = await mb.Conversion.init({
        input,
        output,
        // No resizing here: FFmpeg scales. A bitrate, not a quantizer:
        // Chrome 143 caps the AV1 quantizer at 63 of Mediabunny's 255, which
        // gave every frame its worst quality.
        video:
          job === "encode"
            ? { codec: encodes!, quality: new mb.Quality({ quality: "high", preferBitrate: true }), forceTranscode: true }
            : { codec: handOffCodec!, quality: new mb.Quality("very-high"), forceTranscode: true },
        // Elementary streams hold no audio; a hand-off keeps any audio the
        // .av1 file had.
        audio: job === "encode" ? { discard: true } : {},
        showWarnings: false,
      });
      if (!conversion.utilizedTracks.some((track) => track.isVideoTrack())) {
        const dropped = conversion.discardedTracks.find((entry) => entry.track.isVideoTrack());
        if (dropped?.reason === "undecodable_source_codec" || dropped?.reason === "no_encodable_target_codec") {
          throw unsupported(action, codec, from, to);
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
      data = await video.runFFmpeg({ name, data }, ffmpegStepArgs(step.args, sizes), step.output, progress);
      name = step.output;
    } else if (step.run === "browser") {
      data = await browserStep(data, step.job, progress);
      name = step.job === "encode" ? "encoded.mkv" : "handoff.webm";
    } else {
      data = await video.convertVideo(data, "webm", target, { onProgress: ({ ratio }) => progress(ratio) });
    }
  }
  return data;
}
