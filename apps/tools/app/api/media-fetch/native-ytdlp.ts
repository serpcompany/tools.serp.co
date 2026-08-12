import { existsSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { lookup as lookupMime } from "mime-types";
import { create as createYtDlp } from "youtube-dl-exec";

import { AUDIO_FORMATS, VIDEO_FORMATS } from "../../../lib/capabilities.ts";
import type { ExtractedMediaFormat } from "../../../lib/extractors/index.ts";

const SUPPORTED_EXTENSIONS = new Set([...AUDIO_FORMATS, ...VIDEO_FORMATS]);

function resolvePlatformBinaryName() {
  if (process.platform === "win32") {
    if (process.arch === "arm64") return "yt-dlp_arm64.exe";
    if (process.arch === "ia32") return "yt-dlp_x86.exe";
    return "yt-dlp.exe";
  }
  if (process.platform === "darwin") return "yt-dlp_macos";
  if (process.platform === "linux") {
    if (process.arch === "arm64") return "yt-dlp_linux_aarch64";
    return "yt-dlp_linux";
  }
  return "yt-dlp";
}

const runtimeBinaryName = resolvePlatformBinaryName();
const runtimeBinaryPath = path.join(tmpdir(), "serp-yt-dlp", runtimeBinaryName);
const YTDLP_CANDIDATES = [runtimeBinaryPath];
if (runtimeBinaryName === "yt-dlp" || runtimeBinaryName.endsWith(".exe")) {
  YTDLP_CANDIDATES.push(
    path.resolve(process.cwd(), "node_modules/youtube-dl-exec/bin", runtimeBinaryName),
    path.resolve(process.cwd(), "apps/tools/node_modules/youtube-dl-exec/bin", runtimeBinaryName),
  );
}

let youtubedlInstance: ReturnType<typeof createYtDlp> | null = null;
let ytdlpDownloadPromise: Promise<string> | null = null;

async function downloadYtDlpBinary(targetPath: string) {
  const downloadHost =
    process.env.YTDLP_BINARY_URL ??
    process.env.YOUTUBE_DL_HOST ??
    "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  let response = await fetch(downloadHost, { headers });
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/octet-stream")) {
    if (!response.ok) throw new Error("Unable to resolve yt-dlp release metadata.");
    const payload = (await response.json()) as {
      assets?: Array<{ name?: string; browser_download_url?: string }>;
    };
    const match = payload.assets?.find((asset) => asset.name === runtimeBinaryName);
    if (!match?.browser_download_url) {
      throw new Error("Unable to locate yt-dlp binary in release assets.");
    }
    response = await fetch(match.browser_download_url, { headers });
  }
  if (!response.ok) throw new Error("Failed to download yt-dlp binary.");

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, Buffer.from(await response.arrayBuffer()));
  await fs.chmod(targetPath, 0o755);
  return targetPath;
}

async function getYtDlpInstance() {
  if (youtubedlInstance) return youtubedlInstance;
  const candidate = YTDLP_CANDIDATES.find((value) => existsSync(value));
  if (!ytdlpDownloadPromise) {
    ytdlpDownloadPromise = candidate
      ? Promise.resolve(candidate)
      : downloadYtDlpBinary(runtimeBinaryPath);
  }
  try {
    youtubedlInstance = createYtDlp(await ytdlpDownloadPromise);
    return youtubedlInstance;
  } finally {
    ytdlpDownloadPromise = null;
  }
}

type YtDlpFormat = {
  url?: string;
  ext?: string;
  protocol?: string;
  format_id?: string;
  format_note?: string;
  filesize?: number;
  filesize_approx?: number;
  height?: number;
  tbr?: number;
  vcodec?: string;
  acodec?: string;
  http_headers?: Record<string, string>;
};

type YtDlpInfo = YtDlpFormat & {
  title?: string;
  formats?: YtDlpFormat[];
};

function formatScore(format: YtDlpFormat, mode: "audio" | "video") {
  const extension = String(format.ext ?? "").toLowerCase();
  if (!format.url || !SUPPORTED_EXTENSIONS.has(extension)) return -1;
  if (format.protocol && !/^https?$/.test(format.protocol)) return -1;
  const hasVideo = Boolean(format.vcodec && format.vcodec !== "none");
  const hasAudio = Boolean(format.acodec && format.acodec !== "none");
  if ((mode === "video" && !hasVideo) || (mode === "audio" && !hasAudio)) return -1;
  return (hasVideo ? 1_000_000 : 0) +
    (hasAudio ? 500_000 : 0) +
    Number(format.height ?? 0) * 1_000 +
    Number(format.tbr ?? 0);
}

function selectFormat(info: YtDlpInfo, mode: "audio" | "video") {
  return (info.formats ?? [])
    .map((format) => ({ format, score: formatScore(format, mode) }))
    .filter(({ score }) => score >= 0)
    .sort((left, right) => right.score - left.score)[0]?.format ??
    (info.url ? info : null);
}

function safeFileName(value: string) {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || /[\\/:*?"<>|]/.test(character)
      ? "-"
      : character;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim() || "download";
}

export async function resolveYtDlpMediaFormat(
  targetUrl: URL,
  mode: "audio" | "video",
): Promise<ExtractedMediaFormat> {
  const youtubedl = await getYtDlpInstance();
  const info = (await youtubedl(targetUrl.toString(), {
    download: false,
    dumpSingleJson: true,
    format:
      mode === "video"
        ? "best[protocol^=http][ext=mp4]/best[protocol^=http]/best"
        : "bestaudio[protocol^=http]/bestaudio/best",
    noPlaylist: true,
    noWarnings: true,
  } as never)) as YtDlpInfo;
  const selected = selectFormat(info, mode);
  const extension = String(selected?.ext ?? "").toLowerCase();
  if (!selected?.url || !SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error("Unable to resolve a supported direct media URL.");
  }
  const title = safeFileName(info.title ?? "download");
  const fileName = title.toLowerCase().endsWith(`.${extension}`)
    ? title
    : `${title}.${extension}`;
  return {
    url: selected.url,
    referer: selected.http_headers?.Referer ?? info.http_headers?.Referer,
    contentLength:
      selected.filesize ?? selected.filesize_approx ?? info.filesize ?? info.filesize_approx ?? null,
    contentType: lookupMime(fileName) || "application/octet-stream",
    extension,
    fileName,
    quality: selected.format_note ?? selected.format_id ?? "best",
  };
}
