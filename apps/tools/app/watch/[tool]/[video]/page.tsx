import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ExternalLink } from "lucide-react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { VideoCard } from "@/components/videos/VideoCard";
import { getTool } from "@/lib/catalog/catalog";
import {
  breadcrumbListStructuredData,
  structuredDataOrigin,
  videoObjectStructuredData,
} from "@/lib/structured-data";
import {
  VIDEOS_PATH,
  buildWatchMetadata,
  findWatchVideo,
  relatedWatchVideos,
  watchBreadcrumbs,
  watchPageParams,
  watchVideos,
} from "@/lib/videos";
import { durationLabel, uploadDateLabel } from "@/lib/youtube";

// A how-to video's watch page (issue #374), per the SERP watch-pages
// standard: the video is the page's main content, so Google can list it in
// video results. Its player is in the server HTML, not loaded on a click as
// on the converter page, and its src is the VideoObject's embedUrl. Every
// video is built ahead; any other pair of params is a 404.

type PageProps = {
  params: Promise<{ tool: string; video: string }>;
};

const origin = () =>
  structuredDataOrigin({
    siteEnv: process.env.NEXT_PUBLIC_SITE_ENV,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  });

export function generateStaticParams() {
  return watchPageParams();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tool, video } = await params;
  const watchVideo = findWatchVideo(tool, video, origin());
  return watchVideo ? buildWatchMetadata(watchVideo) : {};
}

export default async function Page({ params }: PageProps) {
  const { tool: toolId, video: videoId } = await params;
  const siteOrigin = origin();
  const video = findWatchVideo(toolId, videoId, siteOrigin);
  if (!video) return notFound();

  const tool = getTool(video.productSlug);
  const toolSummary = tool?.content?.tool.subtitle ?? tool?.description;
  const crumbs = watchBreadcrumbs(video);
  const related = relatedWatchVideos(video, watchVideos(siteOrigin));
  const length = durationLabel(video.duration);
  const uploaded = uploadDateLabel(video.uploadDate);

  return (
    <main className="min-h-screen bg-background">
      <JsonLd
        data={[
          videoObjectStructuredData(video, siteOrigin),
          breadcrumbListStructuredData(crumbs, siteOrigin),
        ]}
      />

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 md:py-12">
        <Breadcrumbs crumbs={crumbs} />

        <div className="mt-6 aspect-video overflow-hidden rounded-xl bg-gray-900 shadow-lg">
          <iframe
            className="h-full w-full border-0"
            src={video.embedUrl}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            data-testid="watch-video-player"
          />
        </div>

        <h1 className="mt-6 text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
          {video.title}
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          {uploaded && (
            <>
              Published <time dateTime={video.uploadDate}>{uploaded}</time>
            </>
          )}
          {uploaded && length && <span aria-hidden="true"> · </span>}
          {length && (
            <>
              Length <time dateTime={video.duration}>{length}</time>
            </>
          )}
        </p>
        <p className="mt-4 whitespace-pre-line break-words text-lg leading-8 text-gray-700">
          {video.description}
        </p>

        <div className="mt-8 rounded-xl border border-blue-100 bg-blue-50/60 p-5 sm:p-6">
          <p className="text-lg font-semibold text-gray-900">{video.productName}</p>
          {toolSummary && <p className="mt-1 text-gray-700">{toolSummary}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link
              href={video.productPath}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              data-testid="watch-tool-link"
            >
              Open the {video.productName}
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
            <a
              href={video.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-blue-700 hover:underline"
              data-testid="watch-source-link"
            >
              Watch on YouTube
              <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>

        {/* Other videos' watch pages; none until a second video is added. */}
        {related.length > 0 && (
          <section aria-labelledby="more-videos" className="mt-12">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="more-videos" className="text-xl font-bold text-gray-900">
                More how-to videos
              </h2>
              <Link
                href={VIDEOS_PATH}
                prefetch={false}
                className="text-sm font-medium text-blue-700 hover:underline"
              >
                All videos
              </Link>
            </div>
            <ul className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((other) => (
                <li key={other.watchPath}>
                  <VideoCard video={other} headingLevel={3} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
