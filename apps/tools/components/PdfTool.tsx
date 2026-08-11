"use client";

import { ToolHeroLayout } from "@/components/ToolHeroLayout";
import { useSpecializedToolWorkflow } from "@/lib/useSpecializedToolWorkflow";

type PdfMode = "edit" | "view";

type PdfToolProps = {
  toolId: string;
  title: string;
  subtitle?: string;
  mode: PdfMode;
};

const viewerBasePath = "/vendor/pdfjs-annotation-extension/web/viewer.html";

function buildViewerUrl(mode: PdfMode, fileUrl?: string): string {
  const hashParams = new URLSearchParams();
  hashParams.set("ae_username", "SERP Tools");
  hashParams.set("ae_get_url", "");
  hashParams.set("ae_post_url", "");
  hashParams.set("ae_default_editor_active", mode === "edit" ? "true" : "false");
  hashParams.set("ae_default_sidebar_open", mode === "edit" ? "true" : "false");
  const query = fileUrl ? `?file=${encodeURIComponent(fileUrl)}` : "";
  return `${viewerBasePath}${query}#${hashParams.toString()}`;
}

export default function PdfTool({ toolId, title, subtitle, mode }: PdfToolProps) {
  const workflow = useSpecializedToolWorkflow();
  const fileUrl = workflow.objectUrl(workflow.delivery);
  const viewerUrl = buildViewerUrl(mode, fileUrl);

  const heroContent = (
    <div className="text-center space-y-3">
      <h1 className="text-3xl font-semibold text-gray-900 sm:text-4xl">{title}</h1>
      <p className="text-base text-gray-600 sm:text-lg">
        {subtitle ?? "Open and annotate PDF documents directly in your browser."}
      </p>
      <p className="text-sm text-gray-500">
        Choose a PDF below, then use the built-in toolbar to view, annotate, and export it.
      </p>
      <label className="mx-auto mt-5 block max-w-md text-left text-sm font-medium text-gray-700">
        PDF document
        <input
          type="file"
          accept=".pdf,application/pdf"
          data-testid="pdf-tool-input"
          className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void workflow.runFile(toolId, file);
          }}
        />
      </label>
      {workflow.busy && <p className="text-sm text-gray-500">Validating PDF…</p>}
      {workflow.error && <p className="text-sm text-red-600">{workflow.error}</p>}
    </div>
  );

  const viewerPanel = (
    <div className="mt-8 overflow-hidden rounded-xl border border-gray-200 shadow-sm">
      <iframe
        title={`${title} viewer`}
        src={viewerUrl}
        data-testid="pdf-tool-viewer"
        className="h-[80vh] w-full bg-white"
        allowFullScreen
      />
    </div>
  );

  return (
    <ToolHeroLayout
      adsVisible={false}
      adSlotPrefix={toolId}
      hero={heroContent}
      below={viewerPanel}
      showInlineAd={false}
      showAdRail={false}
    />
  );
}
