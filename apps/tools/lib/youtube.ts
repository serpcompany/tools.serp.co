// The YouTube URLs a Tool's how-to video (ToolVideo) is played and described
// with, and its length and date as a page shows them. The converter page's
// player (components/ToolVideoPlayer.tsx) uses it, and lib/videos.ts builds
// each video's WatchVideo from it.

// YouTube's hqdefault thumbnail, 480 x 360 with a 16:9 frame letterboxed. It
// exists for every video and is a fifth the size of maxresdefault. The
// converter page's player and the video cards show it, cropped to 16:9 by
// object-cover, so the bars never show.
export const YOUTUBE_THUMBNAIL_WIDTH = 480;
export const YOUTUBE_THUMBNAIL_HEIGHT = 360;

export function youtubeThumbnailUrl(youtubeId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(youtubeId)}/hqdefault.jpg`;
}

// YouTube's maxresdefault thumbnail, 1280 x 720 with no bars: the image
// Google shows in video results, so the VideoObject and the video sitemap
// name it. YouTube makes it only for videos uploaded at 720p or more, and
// answers a 120 x 90 placeholder or a 404 otherwise; docs/videos.md says how
// to check a new video has one.
export function youtubeMaxresThumbnailUrl(youtubeId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(youtubeId)}/maxresdefault.jpg`;
}

// The privacy-enhanced player, which sets no cookies until the video plays:
// the watch page's iframe, and the VideoObject's embedUrl.
export function youtubeEmbedUrl(youtubeId: string): string {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}`;
}

// The video's page on YouTube, its original source.
export function youtubeWatchUrl(youtubeId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}`;
}

const ISO_DURATION = /^PT(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;

// An ISO 8601 duration in whole seconds, as a video sitemap's
// <video:duration> takes it: PT28S is 28 and PT1H2M3S is 3723.
// lib/catalog/validate.ts holds the registry to this form; anything else is
// NaN.
export function durationSeconds(duration: string): number {
  const match = ISO_DURATION.exec(duration);
  if (!match) return Number.NaN;
  const part = (index: number) => Number(match[index] ?? 0);
  return part(1) * 3600 + part(2) * 60 + part(3);
}

// A duration as a player shows it: PT28S is 0:28, PT1H2M3S is 1:02:03, and
// PT90S is 1:30. Anything but an ISO 8601 duration gives "".
export function durationLabel(duration: string): string {
  const total = durationSeconds(duration);
  if (Number.isNaN(total)) return "";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// The day an ISO 8601 upload date names, in its own time zone, as a page
// shows it: 2026-10-22T00:15:20-07:00 is October 22, 2026, wherever and
// whenever the page renders.
export function uploadDateLabel(uploadDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(uploadDate);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || !month) return "";
  return `${month} ${Number(match[3])}, ${match[1]}`;
}
