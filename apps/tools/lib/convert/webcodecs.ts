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
//   frame rate limits of its other video outputs, the browser encodes that, and
//   FFmpeg writes the elementary stream the extension names: IVF for .av1
//   (what aomenc writes, and what our fixture is) and Annex B for .hevc.
//   Neither holds audio.
//
// AV1 to HEVC does both. This module plans the steps; webcodecs-convert.ts
// runs them, and it, Mediabunny and FFmpeg load only when one of these Tools
// runs. A browser without the codec gets a message, not a failure (owner
// decision).

import type { ToolRunMetadata } from "@serp-tools/tool-telemetry";
import { AUDIO_FORMATS } from "../capabilities.ts";
import { MAX_VIDEO_FPS, MAX_VIDEO_SIZE, VIDEO_FILTER, fitWithin } from "./ffmpeg-args.ts";

const AUDIO_FORMAT_SET = new Set<string>(AUDIO_FORMATS);

export type BrowserCodec = "av1" | "hevc";
export type CodecAction = "decode" | "encode";

// The telemetry code for a browser that lacks the codec. The run is handed
// off (to another browser), not failed.
export const CODEC_UNSUPPORTED = "codec_unsupported";

const CODEC_LABELS: Record<BrowserCodec, string> = { av1: "AV1", hevc: "HEVC" };

// Tools whose AV1 or HEVC step runs in the browser. HEVC input stays on
// FFmpeg, which decodes it in software. So does AV1 to audio: FFmpeg takes
// the audio and never decodes the video.
export function usesWebCodecs(from: string, to: string): boolean {
  const target = to.toLowerCase();
  if (target === "av1" || target === "hevc") return true;
  return from.toLowerCase() === "av1" && !AUDIO_FORMAT_SET.has(target);
}

// Worded for every browser: Chrome or Edge can lack the codec too, when the
// device or OS has no encoder for it.
export function codecUnsupportedMessage(action: CodecAction, codec: BrowserCodec): string {
  return `Your browser can't ${action} ${CODEC_LABELS[codec]} on this device. Try a recent Chrome or Edge on a different computer.`;
}

// .av1 and .hevc files are raw video streams with no audio track, so a page
// that reads or writes one says so (owner decision).
export function videoOnlyNote(from?: string, to?: string): string | undefined {
  if (to && AUDIO_FORMAT_SET.has(to.toLowerCase())) return undefined;
  const raw = [...new Set([from, to].map((f) => f?.toLowerCase()))].filter(
    (f): f is BrowserCodec => f === "av1" || f === "hevc",
  );
  if (raw.length === 0) return undefined;
  return `Video only: ${raw.map((f) => `.${f}`).join(" and ")} files are raw video streams with no audio.`;
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

// The frame rate a raw stream records, from the rate measured over the
// hand-off's millisecond timestamps: the whole or NTSC rate (30000/1001 is
// 29.97) it is within 0.05% of, or else the measured rate to a thousandth.
export function streamFrameRate(measured: number): string {
  const whole = Math.round(measured);
  const ntsc = Math.round(measured * 1.001);
  const [label, rate] =
    Math.abs(whole - measured) <= Math.abs((ntsc * 1000) / 1001 - measured)
      ? [String(whole), whole]
      : [`${ntsc * 1000}/1001`, (ntsc * 1000) / 1001];
  return rate > 0 && Math.abs(rate - measured) <= measured * 0.0005
    ? label
    : `${Math.round(measured * 1000)}/1000`;
}

// The bitrate limit of the hand-off to the browser: 8 Mbit/s for a 1280x720
// frame, more in proportion for a bigger one, at most 40 Mbit/s. VP8's -crf
// needs one, and the whole hand-off is held in memory; a fixed 8 Mbit/s held
// 1080p well below the quality -crf 4 asks for.
export function handOffBitrate(frameArea: number): string {
  const mbits = Math.min(40, Math.max(8, (8 * frameArea) / (1280 * 720)));
  return `${Math.round(mbits * 1000)}k`;
}

// Writes the first frame at the hand-off's size as 8-bit grey, one byte a
// pixel, so the file's length is the frame area. FFmpeg.wasm has no ffprobe,
// and Mediabunny can't read many of the input formats (AVI, FLV, WMV, VOB).
export const FRAME_AREA_PROBE = {
  args: ["-map", "0:v:0", "-an", "-frames:v", "1", "-vf", fitWithin(MAX_VIDEO_SIZE), "-pix_fmt", "gray", "-f", "rawvideo"],
  output: "frame.gray",
};

// Arguments between FFmpeg's input and output names. VP8 at high quality is
// the hand-off both ways: FFmpeg encodes it fast and every browser with
// WebCodecs decodes it. Going to the browser it is converted to BT.601 and
// tagged so. Untagged inputs, most of these legacy formats, are BT.601 to
// FFmpeg, so for them that changes nothing; left untagged, the browser would
// read them as BT.709 and shift their colours. `frameRate` is the hand-off's,
// as streamFrameRate names it, and only writing HEVC needs it. `frameArea`,
// from FRAME_AREA_PROBE, sets the bitrate limit of the hand-off to the browser
// (8 Mbit/s without it).
export function ffmpegStepArgs(
  step: "copy-av1" | "to-vp8" | "write-av1" | "write-hevc",
  { frameRate, frameArea = 0 }: { frameRate: string; frameArea?: number },
): string[] {
  switch (step) {
    case "copy-av1":
      return ["-map", "0:v:0", "-map", "0:a:0?", "-c", "copy"];
    case "to-vp8":
      // The deinterlacing and the size and rate limits of FFmpeg's other
      // video outputs, at a constant rate, since a raw HEVC stream has no
      // timestamps.
      return [
        "-map", "0:v:0", "-an",
        "-vf", `${VIDEO_FILTER}:out_color_matrix=bt601`,
        "-fpsmax", String(MAX_VIDEO_FPS), "-fps_mode", "cfr",
        "-colorspace", "smpte170m", "-color_primaries", "smpte170m", "-color_trc", "smpte170m",
        "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8",
        "-crf", "4", "-b:v", handOffBitrate(frameArea), "-auto-alt-ref", "0", "-pix_fmt", "yuv420p",
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
