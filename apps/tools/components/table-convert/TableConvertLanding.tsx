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
import type { FAQ } from "@/types";
import type { InputFormat, OutputFormat } from "@/components/table-convert/types";
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

const buildSubtitle = (fromLabel: string, toLabel: string) =>
  `Paste or upload ${fromLabel} data, preview the table, and export ${toLabel} instantly.`;

const buildAboutSection = (fromLabel: string, toLabel: string) => ({
  title: `${fromLabel} to ${toLabel} table conversion`,
  fromFormat: {
    name: fromLabel,
    fullName: `${fromLabel} table data`,
    description: `Use ${fromLabel} as your input format and we will parse it into a clean table.`,
  },
  toFormat: {
    name: toLabel,
    fullName: `${toLabel} table output`,
    description: `Export the table to ${toLabel} format for your workflow or app.`,
  },
});

const buildHowToSection = (fromLabel: string, toLabel: string) => ({
  title: `How to convert ${fromLabel} to ${toLabel}`,
  intro: `Follow these steps to convert ${fromLabel} to ${toLabel} online.`,
  steps: [
    `Paste or upload your ${fromLabel} data.`,
    "Review the table preview and make edits if needed.",
    `Copy or download the ${toLabel} output when it is ready.`,
  ],
});

const buildInfoArticleSection = (fromLabel: string, toLabel: string) => ({
  title: `About ${fromLabel} to ${toLabel} conversions`,
  markdown: [
    `This converter turns ${fromLabel} table data into ${toLabel} format directly in your browser.`,
    `Use it when you need to move tabular data between tools, systems, or documentation formats.`,
    `**Why use this converter**`,
    `- Live table preview while you edit.`,
    `- Local processing in your browser.`,
    `- Easy copy or download of the result.`,
  ].join("\n\n"),
});

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
        "Auto-convert on every edit.",
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
    "Auto-converts whenever you edit the table.",
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

const buildFaqs = (fromLabel: string, toLabel: string): FAQ[] => [
  {
    question: `How do I convert ${fromLabel} to ${toLabel}?`,
    answer: `Paste or upload ${fromLabel} data, then copy or download the ${toLabel} output from the right panel.`,
  },
  {
    question: "Can I edit the table before exporting?",
    answer: "Yes. Use the online table editor in the middle to make quick edits before exporting.",
  },
  {
    question: "Does this run in the browser?",
    answer: "Yes. Everything runs locally in your browser, so your data stays on your device.",
  },
];

type TableConvertLandingProps = {
  from: InputFormat;
  to: OutputFormat;
  title: string;
  subtitle?: string;
};

export default function TableConvertLanding({
  from,
  to,
  title,
  subtitle,
}: TableConvertLandingProps) {
  const fromLabel = formatTableLabel(from);
  const toLabel = formatTableLabel(to);
  const resolvedSubtitle = subtitle ?? buildSubtitle(fromLabel, toLabel);
  const aboutSection = buildAboutSection(fromLabel, toLabel);
  const howTo = buildHowToSection(fromLabel, toLabel);
  const infoArticle = buildInfoArticleSection(fromLabel, toLabel);
  const workflow = buildWorkflowSection(fromLabel, toLabel);
  const outputDetails = buildOutputDetailsSection(fromLabel, toLabel);
  const quickActions = buildQuickActionsSection(fromLabel, toLabel);
  const socialProof = buildSocialProofSection(fromLabel, toLabel);
  const stats = buildStatsSection();
  const faqs = buildFaqs(fromLabel, toLabel);
  const currentSlug = `${from}-to-${to}`;

  return (
    <main className="theme-light min-h-screen bg-background">
      <TableConvertDemo
        initialInputFormat={from}
        initialOutputFormat={to}
        title={title}
        subtitle={resolvedSubtitle}
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

      <AboutFormatsSection
        title={aboutSection.title}
        fromFormat={aboutSection.fromFormat}
        toFormat={aboutSection.toFormat}
      />

      <HowToSection title={howTo.title} intro={howTo.intro} steps={howTo.steps} />

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

      <InfoArticleSection title={infoArticle.title} markdown={infoArticle.markdown} />

      <FAQSection faqs={faqs} />

      <ToolsLinkHub />
    </main>
  );
}
