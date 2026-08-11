import TableConvertDemo from "@/components/TableConvertDemo";
import { AboutFormatsSection } from "@/components/sections/AboutFormatsSection";
import { FAQSection } from "@/components/sections/FAQSection";
import { HowToSection } from "@/components/sections/HowToSection";
import { InfoArticleSection } from "@/components/sections/InfoArticleSection";
import { RelatedAppsSection } from "@/components/sections/RelatedAppsSection";
import { TableConvertExtensionSection } from "@/components/sections/TableConvertExtensionSection";
import { TableConvertLinksSection } from "@/components/sections/TableConvertLinksSection";
import { TableConvertOptionsSection } from "@/components/sections/TableConvertOptionsSection";
import { TableConvertSocialProofSection } from "@/components/sections/TableConvertSocialProofSection";
import { TableConvertStatsSection } from "@/components/sections/TableConvertStatsSection";
import { TableConvertWorkflowSection } from "@/components/sections/TableConvertWorkflowSection";
import { ToolsLinkHub } from "@/components/sections/ToolsLinkHub";
import { INPUT_FORMATS, OUTPUT_FORMATS } from "@/components/table-convert/formats";
import { formatTableLabel } from "@/lib/table-convert";
import type { InputFormat, OutputFormat } from "@/components/table-convert/types";
import { toolCatalog } from "@serp-tools/app-core/lib/tool-catalog";
import { notFound } from "next/navigation";
import {
  ClipboardCopy,
  Code2,
  Download,
  FileOutput,
  FileSpreadsheet,
  Keyboard,
  MousePointerClick,
  Table2,
  UploadCloud,
  Users,
} from "lucide-react";

const buildWorkflowSection = (fromLabel: string, toLabel: string) => ({
  title: "How the converter works",
  subtitle: `Convert ${fromLabel} to ${toLabel} in three quick steps.`,
  items: [
    {
      title: "Data Source",
      description: `Paste or upload ${fromLabel} data to get started.`,
      bullets: [
        "Drag and drop files into the input panel.",
        "Auto-detect common table formats on upload.",
        "Keep your data in the browser while you work.",
      ],
      icon: UploadCloud,
    },
    {
      title: "Online Table Editor",
      description: "Clean and refine your data in a spreadsheet-style grid.",
      bullets: [
        "Edit cells directly with instant feedback.",
        "Tidy headers and rows in a structured view.",
        "Switch between raw input and table preview.",
      ],
      icon: Table2,
    },
    {
      title: "Table Generator",
      description: `Export to ${toLabel} as soon as you're ready.`,
      bullets: [
        "Select Convert after each edit.",
        "Copy output or download a file in one click.",
        "Preview results before you ship.",
      ],
      icon: FileOutput,
    },
  ],
});

const buildOutputDetailsSection = (fromLabel: string, toLabel: string) => ({
  title: `${toLabel} output details`,
  subtitle: `Everything the converter includes when moving from ${fromLabel} to ${toLabel}.`,
  items: [
    "Preserves the header row and keeps columns aligned.",
    "Select Convert whenever you edit the table.",
    "Escapes special characters when the target format requires it.",
    "Copy output or download it instantly.",
    "Preview data as a table or raw text.",
  ],
});

const buildQuickActionsSection = (fromLabel: string, toLabel: string) => ({
  title: "Quick actions that keep you moving",
  subtitle: `Designed for fast turnarounds when you convert ${fromLabel} to ${toLabel}.`,
  actions: [
    {
      title: "Drag-and-drop import",
      description: "Drop a file into the input panel to load instantly.",
      icon: MousePointerClick,
    },
    {
      title: "Format tabs",
      description: "Switch input and output formats without leaving the page.",
      icon: Keyboard,
    },
    {
      title: "Clipboard ready",
      description: "Copy the output with one click and move on.",
      icon: ClipboardCopy,
    },
    {
      title: "Download output",
      description: "Save the result as a file whenever you need it.",
      icon: Download,
    },
  ],
  cta: {
    label: "Browse all table converters",
    href: "#table-convert-links",
  },
});

const buildSocialProofSection = (fromLabel: string, toLabel: string) => ({
  title: "Built for the way teams share tables",
  subtitle: `From analytics to documentation, convert ${fromLabel} to ${toLabel} in seconds.`,
  groups: [
    {
      title: "Analysts",
      description: "Clean exports quickly and share structured tables with your team.",
      icon: Users,
    },
    {
      title: "Developers",
      description: "Generate JSON, SQL, XML, or HTML for apps and APIs.",
      icon: Code2,
    },
    {
      title: "Content teams",
      description: "Publish clean Markdown or HTML tables in docs and blogs.",
      icon: FileSpreadsheet,
    },
  ],
});

const buildStatsSection = () => ({
  title: "Conversion at a glance",
  stats: [
    {
      value: `${INPUT_FORMATS.length}+`,
      label: "Input formats",
      description: "Paste or upload data from common table types.",
    },
    {
      value: `${OUTPUT_FORMATS.length}+`,
      label: "Output formats",
      description: "Export to code, docs, or database-ready formats.",
    },
    {
      value: "100%",
      label: "Browser-based",
      description: "Runs locally in your browser for quick previews.",
    },
  ],
});

type TableConvertLandingProps = {
  toolId: string;
};

const inputFormatIds = new Set(INPUT_FORMATS.map((format) => format.value));
const outputFormatIds = new Set(OUTPUT_FORMATS.map((format) => format.value));

function isInputFormat(value: string): value is InputFormat {
  return inputFormatIds.has(value);
}

function isOutputFormat(value: string): value is OutputFormat {
  return outputFormatIds.has(value);
}

export default function TableConvertLanding({ toolId }: TableConvertLandingProps) {
  const tool = toolCatalog.getById(toolId);
  const content = toolCatalog.getPageContent(toolId);
  if (
    !tool?.isActive ||
    !tool.from ||
    !tool.to ||
    !content ||
    !isInputFormat(tool.from) ||
    !isOutputFormat(tool.to)
  ) {
    return notFound();
  }

  const from = tool.from;
  const to = tool.to;
  const fromLabel = formatTableLabel(from);
  const toLabel = formatTableLabel(to);
  const workflow = buildWorkflowSection(fromLabel, toLabel);
  const outputDetails = buildOutputDetailsSection(fromLabel, toLabel);
  const quickActions = buildQuickActionsSection(fromLabel, toLabel);
  const socialProof = buildSocialProofSection(fromLabel, toLabel);
  const stats = buildStatsSection();
  const currentSlug = tool.id;

  return (
    <main className="theme-light min-h-screen bg-background">
      <TableConvertDemo
        toolId={toolId}
        initialInputFormat={from}
        initialOutputFormat={to}
        title={content.tool.title}
        subtitle={content.tool.subtitle}
      />

      <TableConvertWorkflowSection
        title={workflow.title}
        subtitle={workflow.subtitle}
        items={workflow.items}
      />

      <TableConvertOptionsSection
        title={outputDetails.title}
        subtitle={outputDetails.subtitle}
        items={outputDetails.items}
      />

      <TableConvertLinksSection currentSlug={currentSlug} />

      {content.aboutSection && (
        <AboutFormatsSection
          title={content.aboutSection.title}
          fromFormat={content.aboutSection.fromFormat}
          toFormat={content.aboutSection.toFormat}
        />
      )}

      {content.howTo && (
        <HowToSection
          title={content.howTo.title}
          intro={content.howTo.intro}
          steps={content.howTo.steps}
        />
      )}

      <TableConvertExtensionSection
        title={quickActions.title}
        subtitle={quickActions.subtitle}
        actions={quickActions.actions}
        cta={quickActions.cta}
      />

      <TableConvertSocialProofSection
        title={socialProof.title}
        subtitle={socialProof.subtitle}
        groups={socialProof.groups}
      />

      <TableConvertStatsSection title={stats.title} stats={stats.stats} />

      <RelatedAppsSection currentFrom={from} currentTo={to} />

      {content.infoArticle && (
        <InfoArticleSection
          title={content.infoArticle.title}
          markdown={content.infoArticle.markdown}
        />
      )}

      {content.faqs && <FAQSection faqs={content.faqs} />}

      <ToolsLinkHub />
    </main>
  );
}
