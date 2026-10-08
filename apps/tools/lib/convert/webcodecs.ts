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
// AV1 to HEVC does both. This module plans the steps; webcodecs-convert.ts
// runs them, and it, Mediabunny and FFmpeg load only when one of these Tools
// runs. A browser without the codec gets a message, not a failure (owner
// decision).

import type { ToolRunMetadata } from "@serp-tools/tool-telemetry";

export type BrowserCodec = "av1" | "hevc";
export type CodecAction = "decode" | "encode";

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

export function codecUnsupportedError(action: CodecAction, codec: BrowserCodec, from: string, to: string) {
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
