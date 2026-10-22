import { youtubeEmbedUrl } from "@/lib/youtube";

type ToolVideoPlayerProps = {
  youtubeId: string;
  title: string;
};

// A Tool's how-to video on its converter page (issue #374): YouTube's player
// itself, in the server HTML, ready to play. It sits under the guide, well
// below the converter, and loads lazily, so the browser fetches the player
// (about 1 MB of scripts, and the cookies it sets) from youtube-nocookie.com
// only as a visitor scrolls near it, not with the page. The box keeps the
// video's 16:9 shape, so nothing moves as it loads.
export function ToolVideoPlayer({ youtubeId, title }: ToolVideoPlayerProps) {
  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-gray-900 shadow-lg">
      <iframe
        className="absolute inset-0 h-full w-full border-0"
        src={`${youtubeEmbedUrl(youtubeId)}?rel=0`}
        title={title}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
        data-testid="tool-video-player"
      />
    </div>
  );
}
