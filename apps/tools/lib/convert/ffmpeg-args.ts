// FFmpeg.wasm command lines for converting and compressing media. Pure, so
// the arguments each format needs can be tested without loading FFmpeg.
import { AUDIO_FORMATS } from "../capabilities.ts";
import { mapQualityToAudioBitrate, mapQualityToVideoCrf } from "../compression-utils.ts";

const FAST_VIDEO_FILTER = "fps=12,scale=320:-2:flags=fast_bilinear";
const FAST_GIF_FILTER = "fps=10,scale=320:-1:flags=fast_bilinear";
// H.263 encodes only its five standard frame sizes. 352x288 (CIF) is the one
// closest to 320x240: fit the picture inside it and pad the rest.
const H263_CIF_FILTER =
  "scale=352:288:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=fast_bilinear," +
  "pad=352:288:(ow-iw)/2:(oh-ih)/2,setsar=1";
const MXF_VIDEO_FILTER = "scale=320:-2:flags=fast_bilinear";
// libopus in @ffmpeg/core 0.12.6 reads out of bounds ("memory access out of
// bounds") on two or more channels at complexity 5 and above; the default is
// 10. Complexity 4 encodes stereo and 5.1 at every bitrate the Tools use.
const LIBOPUS = ["-acodec", "libopus", "-compression_level", "4"];
const AUDIO_FORMAT_SET = new Set(AUDIO_FORMATS);

export type FFmpegCommand = {
  inputName: string;
  outputName: string;
  args: string[];
  // Runs before args and writes files args reads (the GIF palette).
  prepass?: string[];
  scratchFiles?: string[];
};

function canRemux(fromFormat: string, toFormat: string) {
  const from = fromFormat.toLowerCase();
  const to = toFormat.toLowerCase();
  return (
    (from === "mkv" && ["mov", "mp4", "m4v"].includes(to)) ||
    (from === "mp4" && ["mkv", "mov", "m4v", "ts", "mts", "m2ts"].includes(to))
  );
}

export function buildConvertCommand(fromFormat: string, toFormat: string): FFmpegCommand {
  const inputName = `input.${fromFormat}`;
  let outputName = `output.${toFormat}`;
  let prepass: string[] | undefined;

  const baseArgs = ['-y', '-nostdin'];
  let args: string[] = [...baseArgs, '-i', inputName];

  // For container-to-container conversions with compatible codecs, use copy (super fast)
  const canUseCopyCodec = canRemux(fromFormat, toFormat);

  if (canUseCopyCodec) {
    // Just copy streams without re-encoding (FAST)
    args.push('-c', 'copy');
    if (['mp4', 'm4v'].includes(toFormat)) {
      args.push('-movflags', '+faststart');
    }
  }
  // Audio extraction from MP4
  else if ([
    'mp3', 'wav', 'ogg', 'oga', 'aac', 'm4a', 'm4r', 'opus', 'flac', 'wma', 'aiff', 'mp2',
    'alac', 'amr', 'au', 'caf', 'cdda'
  ].includes(toFormat)) {
    const needsAmrResample = fromFormat.toLowerCase() === "amr"
      && ["mp2", "ogg", "oga"].includes(toFormat);
    if (toFormat === 'mp3') {
      args.push('-acodec', 'libmp3lame', '-b:a', '192k');
    } else if (toFormat === 'wav') {
      args.push('-acodec', 'pcm_s16le');
    } else if (toFormat === 'ogg') {
      args.push('-acodec', 'libvorbis', '-q:a', '5');
    } else if (toFormat === 'oga') {
      args.push('-acodec', 'libvorbis', '-q:a', '5', '-f', 'ogg');
    } else if (toFormat === 'aac') {
      args.push('-acodec', 'aac', '-b:a', '192k');
    } else if (toFormat === 'm4a') {
      args.push('-acodec', 'aac', '-b:a', '192k');
    } else if (toFormat === 'm4r') {
      args.push('-acodec', 'aac', '-b:a', '192k', '-f', 'ipod');
    } else if (toFormat === 'opus') {
      args.push(...LIBOPUS, '-b:a', '128k');
    } else if (toFormat === 'flac') {
      args.push('-acodec', 'flac');
    } else if (toFormat === 'wma') {
      args.push('-acodec', 'wmav2', '-b:a', '192k');
    } else if (toFormat === 'aiff') {
      args.push('-acodec', 'pcm_s16be');
    } else if (toFormat === 'mp2') {
      args.push('-acodec', 'mp2', '-b:a', '192k');
    } else if (toFormat === 'alac') {
      args.push('-acodec', 'alac', '-f', 'ipod');
    } else if (toFormat === 'amr') {
      args.push('-acodec', 'libopencore_amrnb', '-ar', '8000', '-ac', '1', '-b:a', '12.2k', '-f', 'amr');
    } else if (toFormat === 'au') {
      args.push('-acodec', 'pcm_s16be', '-ar', '44100', '-ac', '2', '-f', 'au');
    } else if (toFormat === 'caf') {
      args.push('-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', '-f', 'caf');
    } else if (toFormat === 'cdda') {
      args.push('-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', '-f', 's16le');
    }
    if (needsAmrResample) {
      args.push('-ar', '44100', '-ac', '2');
    }
    args.push('-vn'); // No video for audio extraction
  }
  // Video conversions - optimized for speed
  else if (toFormat === 'mp4') {
    // Use ultrafast preset for speed, higher CRF for smaller file
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '32', '-tune', 'zerolatency');
    args.push('-c:a', 'aac', '-b:a', '96k');
    args.push('-movflags', '+faststart');
    args.push('-vf', FAST_VIDEO_FILTER);
  } else if (toFormat === 'mkv') {
    // MKV container - can hold almost any codec
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '32', '-tune', 'zerolatency');
    args.push('-c:a', 'aac', '-b:a', '96k');
    args.push('-vf', FAST_VIDEO_FILTER);
  } else if (toFormat === 'webm') {
    // Use faster VP8 instead of VP9
    args.push(
      '-c:v',
      'libvpx',
      '-crf',
      '40',
      '-b:v',
      '0',
      '-deadline',
      'realtime',
      '-cpu-used',
      '8',
      '-auto-alt-ref',
      '0',
      '-pix_fmt',
      'yuv420p'
    );
    if (fromFormat === 'gif') {
      args.push('-an');
    } else {
      args.push('-c:a', 'libvorbis', '-b:a', '64k');
    }
    args.push('-vf', FAST_VIDEO_FILTER);
  } else if (toFormat === 'avi') {
    args.push('-c:v', 'mpeg4', '-vtag', 'xvid', '-q:v', '10', '-bf', '0');
    args.push('-c:a', 'libmp3lame', '-b:a', '96k');
    args.push('-vf', FAST_VIDEO_FILTER);
  } else if (toFormat === 'mov') {
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '32', '-tune', 'zerolatency');
    args.push('-c:a', 'aac', '-b:a', '96k');
    args.push('-movflags', '+faststart');
    args.push('-vf', FAST_VIDEO_FILTER);
  } else if (toFormat === 'flv') {
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '32', '-tune', 'zerolatency');
    args.push('-c:a', 'aac', '-b:a', '96k');
    args.push('-vf', FAST_VIDEO_FILTER);
    args.push('-f', 'flv');
  } else if (toFormat === 'ts' || toFormat === 'mts' || toFormat === 'm2ts') {
    // MPEG Transport Stream
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-tune', 'zerolatency');
    args.push('-c:a', 'aac', '-b:a', '96k');
    args.push('-vf', FAST_VIDEO_FILTER);
    args.push('-f', 'mpegts');
  } else if (toFormat === 'm4v') {
    // M4V is basically MP4 with iTunes compatibility
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-tune', 'zerolatency');
    args.push('-c:a', 'aac', '-b:a', '96k');
    args.push('-movflags', '+faststart');
    args.push('-vf', FAST_VIDEO_FILTER);
  } else if (toFormat === 'mpeg' || toFormat === 'mpg') {
    // MPEG-1/2 format
    args.push('-c:v', 'mpeg2video', '-q:v', '6');
    args.push('-c:a', 'mp2', '-b:a', '96k');
    args.push('-vf', FAST_VIDEO_FILTER);
  } else if (toFormat === 'vob') {
    // DVD Video Object
    args.push('-c:v', 'mpeg2video', '-q:v', '6');
    args.push('-c:a', 'mp2', '-b:a', '96k');
    args.push('-vf', FAST_VIDEO_FILTER);
    args.push('-f', 'dvd');
  } else if (toFormat === '3gp') {
    // Mobile phone format
    args.push('-c:v', 'h263', '-vf', H263_CIF_FILTER, '-b:v', '200k', '-r', '12');
    args.push('-c:a', 'aac', '-b:a', '24k', '-ar', '8000', '-ac', '1');
  } else if (toFormat === 'mxf') {
    // MXF (OP1a) only takes 48 kHz audio and broadcast frame rates.
    args.push('-c:v', 'mpeg2video', '-b:v', '2000k', '-pix_fmt', 'yuv422p');
    args.push('-vf', MXF_VIDEO_FILTER, '-r', '25');
    args.push('-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2');
    args.push('-f', 'mxf');
  } else if (toFormat === 'f4v') {
    // Flash Video (F4V)
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '32', '-tune', 'zerolatency');
    args.push('-c:a', 'aac', '-b:a', '96k');
    args.push('-vf', FAST_VIDEO_FILTER);
    args.push('-f', 'f4v');
  } else if (toFormat === 'hevc') {
    // HEVC/H.265 codec in MP4 container
    args.push('-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '35');
    args.push('-c:a', 'aac', '-b:a', '96k');
    args.push('-tag:v', 'hvc1'); // For better compatibility
    args.push('-vf', FAST_VIDEO_FILTER);
    outputName = outputName.replace('.hevc', '.mp4'); // Use MP4 container
  } else if (toFormat === 'divx') {
    // DivX (MPEG-4 Part 2) in AVI container
    args.push('-c:v', 'mpeg4', '-vtag', 'DIVX', '-q:v', '10');
    args.push('-c:a', 'mp3', '-b:a', '96k');
    args.push('-vf', FAST_VIDEO_FILTER);
    outputName = outputName.replace('.divx', '.avi'); // Use AVI container
  } else if (toFormat === 'av1') {
    // AV1 codec in MP4 container
    args.push('-c:v', 'libaom-av1', '-crf', '35', '-b:v', '0', '-cpu-used', '8');
    args.push('-c:a', 'aac', '-b:a', '96k');
    args.push('-tag:v', 'av01');
    args.push('-movflags', '+faststart');
    args.push('-vf', FAST_VIDEO_FILTER);
    outputName = outputName.replace('.av1', '.mp4'); // Use MP4 container
  } else if (toFormat === 'avchd') {
    // AVCHD-style transport stream
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-tune', 'zerolatency');
    args.push('-c:a', 'aac', '-b:a', '96k');
    args.push('-vf', FAST_VIDEO_FILTER);
    args.push('-f', 'mpegts');
    outputName = outputName.replace('.avchd', '.m2ts'); // Use M2TS container
  } else if (toFormat === 'mjpeg') {
    // Motion JPEG
    args.push('-c:v', 'mjpeg', '-q:v', '8', '-r', '12');
    args.push('-c:a', 'pcm_s16le');
    args.push('-vf', FAST_VIDEO_FILTER);
    outputName = outputName.replace('.mjpeg', '.avi'); // Use AVI container
  } else if (toFormat === 'mpeg2') {
    // MPEG-2 format
    args.push('-c:v', 'mpeg2video', '-q:v', '6');
    args.push('-c:a', 'mp2', '-b:a', '96k');
    args.push('-vf', FAST_VIDEO_FILTER);
    outputName = outputName.replace('.mpeg2', '.mpg'); // Use MPG extension
  } else if (toFormat === 'asf') {
    // Windows Media format
    args.push('-c:v', 'wmv2', '-b:v', '500k');
    args.push('-c:a', 'wmav2', '-b:a', '96k');
    args.push('-vf', FAST_VIDEO_FILTER);
  } else if (toFormat === 'gif') {
    // Generate palette for better quality
    const paletteName = 'palette.png';
    prepass = [
      '-i', inputName,
      '-vf', `${FAST_GIF_FILTER},palettegen`,
      paletteName
    ];

    // Use palette to create GIF
    args = [
      ...baseArgs,
      '-i', inputName,
      '-i', paletteName,
      '-lavfi', `${FAST_GIF_FILTER}[x];[x][1:v]paletteuse`,
      '-loop', '0',
    ];
  }

  args.push(outputName);

  return {
    inputName,
    outputName,
    args,
    ...(prepass ? { prepass, scratchFiles: ['palette.png'] } : {}),
  };
}

function buildAudioCompressionArgs(format: string, bitrate: string): string[] {
  switch (format) {
    case "mp3":
      return ["-vn", "-acodec", "libmp3lame", "-b:a", bitrate];
    case "aac":
      return ["-vn", "-acodec", "aac", "-b:a", bitrate];
    case "m4a":
      return ["-vn", "-acodec", "aac", "-b:a", bitrate];
    case "m4r":
      return ["-vn", "-acodec", "aac", "-b:a", bitrate, "-f", "ipod"];
    case "ogg":
      return ["-vn", "-acodec", "libvorbis", "-q:a", "4"];
    case "oga":
      return ["-vn", "-acodec", "libvorbis", "-q:a", "4", "-f", "ogg"];
    case "opus":
      return ["-vn", ...LIBOPUS, "-b:a", bitrate];
    case "wma":
      return ["-vn", "-acodec", "wmav2", "-b:a", bitrate];
    case "mp2":
      return ["-vn", "-acodec", "mp2", "-b:a", bitrate];
    case "amr":
      return ["-vn", "-acodec", "libopencore_amrnb", "-ar", "8000", "-ac", "1", "-b:a", "12.2k", "-f", "amr"];
    case "flac":
      return ["-vn", "-acodec", "flac", "-compression_level", "8"];
    case "alac":
      return ["-vn", "-acodec", "alac", "-f", "ipod"];
    case "wav":
      return ["-vn", "-acodec", "pcm_s16le"];
    case "aiff":
      return ["-vn", "-acodec", "pcm_s16be"];
    case "au":
      return ["-vn", "-acodec", "pcm_s16be", "-ar", "44100", "-ac", "2", "-f", "au"];
    case "caf":
      return ["-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", "-f", "caf"];
    case "cdda":
      return ["-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", "-f", "s16le"];
    default:
      return ["-vn", "-b:a", bitrate];
  }
}

function buildVideoCompressionArgs(format: string, crf: number, audioBitrate: string): string[] {
  if (format === "webm") {
    const webmCrf = Math.min(63, Math.max(24, Math.round(crf * 1.6)));
    return [
      "-c:v",
      "libvpx",
      "-crf",
      String(webmCrf),
      "-b:v",
      "0",
      "-deadline",
      "good",
      "-cpu-used",
      "4",
      "-auto-alt-ref",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "libvorbis",
      "-b:a",
      audioBitrate,
    ];
  }

  const args = [
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    String(crf),
    "-c:a",
    "aac",
    "-b:a",
    audioBitrate,
  ];

  if (["mp4", "mov", "m4v"].includes(format)) {
    args.push("-movflags", "+faststart");
  }

  return args;
}

// `format` is a lowercase audio or video format.
export function buildCompressionCommand(format: string, quality?: number): FFmpegCommand {
  const inputName = `input.${format}`;
  const outputName = `output.${format}`;
  const audioBitrate = mapQualityToAudioBitrate(quality);
  const crf = mapQualityToVideoCrf(quality);
  const specificArgs = AUDIO_FORMAT_SET.has(format)
    ? buildAudioCompressionArgs(format, audioBitrate)
    : buildVideoCompressionArgs(format, crf, audioBitrate);
  return {
    inputName,
    outputName,
    args: ["-y", "-nostdin", "-i", inputName, ...specificArgs, outputName],
  };
}
