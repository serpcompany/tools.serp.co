import Link from "next/link";

import type { WatchVideo } from "@/lib/videos";
import {
  YOUTUBE_THUMBNAIL_HEIGHT,
  YOUTUBE_THUMBNAIL_WIDTH,
  durationLabel,
  youtubeThumbnailUrl,
} from "@/lib/youtube";

type VideoCardProps = {
  video: WatchVideo;
  // The card's title is a heading at this level: h2 on /videos/, h3 under a
  // watch page's "More how-to videos".
  headingLevel: 2 | 3;
};

// A video in a list: its thumbnail, length, title and Tool, linking to its
// watch page, never to YouTube.
export function VideoCard({ video, headingLevel }: VideoCardProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const length = durationLabel(video.duration);
  return (
    <Link
      href={video.watchPath}
      prefetch={false}
      className="group block overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
    >
      <div className="relative aspect-video bg-gray-900">
        {/* The thumbnail comes from YouTube's image host, which Next's image optimizer doesn't serve. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={youtubeThumbnailUrl(video.id)}
          alt=""
          width={YOUTUBE_THUMBNAIL_WIDTH}
          height={YOUTUBE_THUMBNAIL_HEIGHT}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
        {length && (
          <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium text-white">
            <span className="sr-only">Length </span>
            {length}
          </span>
        )}
      </div>
      <div className="p-4">
        <Heading className="font-semibold leading-snug text-gray-900 group-hover:text-blue-700">
          {video.title}
        </Heading>
        <p className="mt-1 text-sm text-gray-600">{video.productName}</p>
      </div>
    </Link>
  );
}
