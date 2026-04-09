import HtmlToMarkdownConverter from "@/components/HtmlToMarkdownConverter";
import { FAQSection } from "@/components/sections/FAQSection";
import { HowToSection } from "@/components/sections/HowToSection";
import { InfoArticleSection } from "@/components/sections/InfoArticleSection";
import { ToolsLinkHub } from "@/components/sections/ToolsLinkHub";
import { buildToolMetadata } from "@/lib/metadata";

const toolId = "html-to-markdown";

export const generateMetadata = () => buildToolMetadata(toolId);

export default function Page() {
  return (
    <main className="min-h-screen bg-background">
      <HtmlToMarkdownConverter />

      <HowToSection
        title="How to convert HTML to Markdown"
        intro="Follow these steps to convert HTML to Markdown online."
        steps={[
          "Paste your HTML into the left panel (or clear it and type your own).",
          "The Markdown equivalent appears instantly in the right panel.",
          "Click Copy to copy the result to your clipboard, or Download .md to save the file.",
        ]}
      />

      <InfoArticleSection
        title="About HTML to Markdown conversion"
        markdown={[
          "This converter turns full HTML documents or snippets into clean Markdown text, directly in your browser using the high-performance [html-to-markdown](https://github.com/kreuzberg-dev/html-to-markdown) WebAssembly library.",
          "**Why convert HTML to Markdown?**",
          "Markdown is a lightweight, human-readable format widely used in documentation, README files, wikis, static site generators, and note-taking apps like Obsidian and Notion. Converting HTML to Markdown makes content easier to edit, diff, and version-control.",
          "**Privacy first**",
          "All processing happens locally in your browser via WebAssembly. Your HTML is never uploaded to any server.",
          "**What is supported?**",
          "- Headings (h1–h6)\n- Paragraphs and line breaks\n- Bold, italic, and strikethrough text\n- Ordered and unordered lists\n- Links and images\n- Blockquotes\n- Inline and fenced code blocks\n- HTML tables",
        ].join("\n\n")}
      />

      <FAQSection
        faqs={[
          {
            question: "What types of HTML does this converter support?",
            answer:
              "The converter handles full HTML pages as well as fragments, including headings, paragraphs, lists, links, images, tables, blockquotes, and code blocks.",
          },
          {
            question: "Does it handle HTML tables?",
            answer:
              "Yes. HTML tables are converted to Markdown GFM-style tables where possible.",
          },
          {
            question: "Is my HTML sent to a server?",
            answer:
              "No. Conversion happens entirely in your browser using a WebAssembly module. Your data never leaves your device.",
          },
          {
            question: "Can I convert a full web page?",
            answer:
              "Yes. Paste the full HTML source of any web page and the tool will convert the entire document to Markdown.",
          },
          {
            question: "What is the difference between this and the HTML Table to Markdown converter?",
            answer:
              "The table converter is specialized for converting tabular data (HTML <table> elements) to Markdown tables. This tool converts entire HTML documents or any HTML snippet—including text, headings, links, and more—to Markdown.",
          },
        ]}
      />

      <ToolsLinkHub />
    </main>
  );
}
