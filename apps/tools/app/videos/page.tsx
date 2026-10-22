import { notFound } from "next/navigation";

import { JsonLd } from "@/components/JsonLd";
import { VideoCard } from "@/components/videos/VideoCard";
import { structuredDataOrigin, videoListStructuredData } from "@/lib/structured-data";
import { VIDEOS_TITLE, buildVideosMetadata, watchVideos } from "@/lib/videos";

// The video library (issue #374): a card per how-to video, newest first,
// each linking to its watch page, never to YouTube. Its ItemList lists the
// same videos in the same order.

export const metadata = buildVideosMetadata();

export default function Page() {
  const origin = structuredDataOrigin({
    siteEnv: process.env.NEXT_PUBLIC_SITE_ENV,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  });
  const videos = watchVideos(origin);
  // Not in the sitemap either until there is a video (lib/sitemap.ts).
  if (videos.length === 0) return notFound();

  return (
    <main className="min-h-screen bg-background">
      <JsonLd data={videoListStructuredData(VIDEOS_TITLE, videos)} />

      <section className="border-b bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.12),_transparent_55%),linear-gradient(180deg,_rgba(248,250,252,0.98)_0%,_rgba(255,255,255,1)_100%)]">
        <div className="container py-14 md:py-20">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-sky-600">Videos</p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">
              {VIDEOS_TITLE}
            </h1>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">
              Short videos that show how to use SERP Tools&apos; free converters, step by step.
              Open one to watch it, then try its converter on your own file.
            </p>
          </div>
        </div>
      </section>

      <section className="container py-12">
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((video) => (
            <li key={video.watchPath}>
              <VideoCard video={video} headingLevel={2} />
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
