"use client";

import { useEffect, useRef, useState } from "react";

import {
  YOUTUBE_THUMBNAIL_HEIGHT,
  YOUTUBE_THUMBNAIL_WIDTH,
  durationLabel,
  youtubeEmbedUrl,
  youtubeThumbnailUrl,
} from "@/lib/youtube";

type ToolVideoPlayerProps = {
  youtubeId: string;
  title: string;
  // ISO 8601, e.g. PT28S.
  duration: string;
};

// A Tool's how-to video on its converter page, loaded on a click (issue
// #374). Until a visitor clicks play it is the video's thumbnail and a play
// button; YouTube's player (about 1 MB of scripts, and the cookies it sets
// once it plays) loads only then, from youtube-nocookie.com, and starts
// playing. The box keeps the video's 16:9 shape and the thumbnail has its own
// width and height, so nothing moves as either loads. The video's watch page
// embeds the player directly instead: there the video is the page.
export function ToolVideoPlayer({ youtubeId, title, duration }: ToolVideoPlayerProps) {
  const [playing, setPlaying] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const length = durationLabel(duration);

  // The play button is gone once the player loads: keep keyboard focus on it.
  useEffect(() => {
    if (playing) frameRef.current?.focus();
  }, [playing]);

  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-gray-900 shadow-lg">
      {playing ? (
        <iframe
          ref={frameRef}
          className="absolute inset-0 h-full w-full border-0"
          src={`${youtubeEmbedUrl(youtubeId)}?autoplay=1&rel=0`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={length ? `Play video: ${title}, ${length}` : `Play video: ${title}`}
          className="group absolute inset-0 h-full w-full cursor-pointer focus-visible:outline focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-blue-500"
          data-testid="tool-video-play"
        >
          {/* The thumbnail comes from YouTube's image host, which Next's image optimizer doesn't serve. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={youtubeThumbnailUrl(youtubeId)}
            alt=""
            width={YOUTUBE_THUMBNAIL_WIDTH}
            height={YOUTUBE_THUMBNAIL_HEIGHT}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 flex h-12 w-[68px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl bg-black/75 transition-colors group-hover:bg-red-600 group-focus-visible:bg-red-600"
          >
            <svg viewBox="0 0 24 24" className="ml-1 h-6 w-6 fill-white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
          {length && (
            <time
              aria-hidden="true"
              dateTime={duration}
              className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium text-white"
            >
              {length}
            </time>
          )}
        </button>
      )}
    </div>
  );
}
