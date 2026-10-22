import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ToolVideoPlayer } from "@/components/ToolVideoPlayer";
import { VIDEOS_PATH, watchPath } from "@/lib/videos";
import type { ToolVideo } from "@/types";

type ToolVideoSectionProps = {
  toolId: string;
  video: ToolVideo;
};

// A converter page's how-to video, right under its guide (HowToSection) and
// on the same band, so it reads as part of the guide: the player, and a link to the video's watch page, where Google lists it.
export function ToolVideoSection({ toolId, video }: ToolVideoSectionProps) {
  return (
    <section aria-label="How-to video" className="bg-gray-50 pb-20">
      <figure className="mx-auto max-w-3xl px-6">
        <ToolVideoPlayer youtubeId={video.id} title={video.title} />
        <figcaption className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center text-sm text-gray-600">
          <Link
            href={watchPath(toolId, video.id)}
            prefetch={false}
            className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline"
            data-testid="tool-video-watch-link"
          >
            {video.title}
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
          <Link href={VIDEOS_PATH} prefetch={false} className="hover:text-blue-700 hover:underline">
            All how-to videos
          </Link>
        </figcaption>
      </figure>
    </section>
  );
}
