import { notFound } from "next/navigation";

import { DownloaderPageRenderer } from "@/components/DownloaderPageRenderer";
import PdfToolPage from "@/components/PdfToolPage";
import ToolPlaceholder from "@/components/ToolPlaceholder";
import { ToolPageRenderer } from "@/components/ToolPageRenderer";
import { getTool } from "@/lib/catalog/catalog";
import { buildToolMetadata } from "@/lib/metadata";

type PageProps = {
  params: Promise<{ tool: string }>;
};

// Every Tool without its own folder is a static page, rendered on its first
// request and served from the incremental cache afterwards (issue #315).
// None is built ahead: the deploy doesn't upload build-time pages to R2, so
// listing them would only lengthen the build. Nothing here may read request
// data (lib/tool-route-static.test.mjs). A slug that isn't an active Tool
// renders the 404, which open-next.config.ts never stores.
export function generateStaticParams(): { tool: string }[] {
  return [];
}

export const dynamicParams = true;

export async function generateMetadata({ params }: PageProps) {
  const { tool: toolId } = await params;
  return buildToolMetadata(toolId);
}

export default async function Page({ params }: PageProps) {
  const { tool: toolId } = await params;
  const tool = getTool(toolId);

  if (!tool) {
    return notFound();
  }

  if (
    (tool.operation === "convert" || tool.operation === "compress") &&
    tool.from &&
    tool.to
  ) {
    return <ToolPageRenderer toolId={toolId} />;
  }

  if (tool.operation === "download") {
    return <DownloaderPageRenderer toolId={toolId} />;
  }

  if (
    tool.operation === "video-editor" ||
    tool.operation === "image-editor" ||
    tool.operation === "audio-editor"
  ) {
    return <ToolPlaceholder title={tool.name} />;
  }

  if (tool.operation === "view" || tool.operation === "edit") {
    return <PdfToolPage toolId={toolId} />;
  }

  return notFound();
}
