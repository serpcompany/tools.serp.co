import type { FAQ, InfoArticleSectionData, HowToSectionData, Tool } from "@/types";

import { howToHeading, onConverterPage, runsInBrowser } from "./metadata.ts";

// The template sections of a page without curated ones. Converter and
// compressor pages say only what is true of every Tool they cover (#356):
// where the file is converted follows runsInBrowser, and a compressor never
// promises the same quality, since most re-encode lossily.

const formatLabel = (value: string | undefined) => {
  if (!value) return "";
  const upper = value.toUpperCase();
  if (upper === "JPG") return "JPG";
  if (upper === "SVG") return "SVG";
  return upper;
};

const buildLabels = (tool: Tool) => {
  const fromSource = tool.from ?? tool.content?.tool?.from;
  const toSource = tool.to ?? tool.content?.tool?.to;
  const fromLabel = formatLabel(fromSource) || "FILES";
  const toLabel = formatLabel(toSource) || fromLabel;
  return { fromLabel, toLabel };
};

const isCompressionTool = (tool: Tool) => {
  if (tool.operation === "compress") return true;
  const haystack = `${tool.name} ${tool.description}`.toLowerCase();
  return haystack.includes("compress") || haystack.includes("optimiz");
};

const actionVerb = (tool: Tool) => {
  if (tool.operation === "edit") return "edit";
  if (tool.operation === "view") return "view";
  if (tool.operation === "combine") return "combine";
  if (tool.operation === "download") return "download";
  if (tool.operation === "bulk" && isCompressionTool(tool)) return "batch compress";
  if (tool.operation === "bulk") return "batch convert";
  if (isCompressionTool(tool)) return "compress";
  return "convert";
};

export function buildHowToSection(tool: Tool): HowToSectionData {
  const { fromLabel, toLabel } = buildLabels(tool);
  const verb = actionVerb(tool);

  let title = `How to ${verb} ${fromLabel} to ${toLabel}`;
  let intro = `Follow these steps to ${verb} ${fromLabel} to ${toLabel} online.`;
  if (tool.operation === "view") {
    title = `How to view ${fromLabel} files`;
    intro = `Follow these steps to view ${fromLabel} files online.`;
  } else if (tool.operation === "edit") {
    title = `How to edit ${fromLabel} files`;
    intro = `Follow these steps to edit ${fromLabel} files online.`;
  } else if (tool.operation === "combine") {
    title = `How to combine ${fromLabel} into one ${toLabel} file`;
    intro = `Follow these steps to merge ${fromLabel} files into one ${toLabel} file.`;
  } else if (tool.operation === "download") {
    title = `How to download ${fromLabel} files`;
    intro = `Follow these steps to download ${fromLabel} files to your device.`;
  } else if (isCompressionTool(tool) && fromLabel === toLabel) {
    title = `How to compress ${fromLabel} files`;
    intro = `Follow these steps to make ${fromLabel} files smaller online.`;
  }

  const converterPage = onConverterPage(tool);
  // A converter page's heading is the question people search (#356).
  if (converterPage) title = howToHeading(tool) ?? title;
  const steps: string[] = [
    converterPage
      ? `Choose your ${fromLabel} file, or several at once.`
      : `Upload your ${fromLabel} file${tool.operation === "bulk" || tool.operation === "combine" ? "s" : ""}.`,
  ];

  if (tool.operation === "view") {
    steps.push(`Open and read your ${fromLabel} file in the viewer.`);
    steps.push("Use the page and zoom controls to navigate.");
    steps.push("Download a copy if you need it offline.");
  } else if (tool.operation === "edit") {
    steps.push(`Make your edits inside the ${fromLabel} editor.`);
    steps.push("Use highlight, underline, text, or draw tools to add annotations.");
    steps.push(`Download the updated ${toLabel} file when finished.`);
  } else if (tool.operation === "combine") {
    steps.push("Arrange or confirm the file order before combining.");
    steps.push(`Download the merged ${toLabel} file when the process finishes.`);
  } else if (tool.operation === "bulk") {
    steps.push(`We process each file and prepare the ${toLabel} outputs.`);
    steps.push("Download the results as a ZIP once processing completes.");
  } else if (tool.operation === "download") {
    steps.push("Start the download and wait for the file to finish.");
    steps.push("Save the file to your device.");
  } else if (converterPage && tool.operation === "compress") {
    steps.push(`Wait while the compressor makes a smaller ${toLabel} copy.`);
    steps.push("Download the compressed file. If it can't be made smaller, you get the original back.");
  } else if (converterPage) {
    steps.push(`Wait while the converter turns each file into ${toLabel}.`);
    steps.push(`Download each new ${toLabel} file. Your original file isn't changed.`);
  } else {
    steps.push(`We ${verb} your file and prepare the ${toLabel} output.`);
    steps.push(`Download the new ${toLabel} file when the conversion completes.`);
  }

  return { title, intro, steps };
}

// The converter page's file filter for a Tool without curated content.
// content:apply gives a Tool it adds content to the same one, so its page
// keeps accepting the same files.
export function converterAccept(from: string): string {
  if (from === "pdf") return ".pdf";
  if (from === "jpg") return ".jpg,.jpeg";
  if (from === "jpeg") return ".jpeg,.jpg";
  if (from === "tiff") return ".tif,.tiff";
  return `.${from}`;
}

// Where a converter page's file is converted, for its article and FAQs. A
// server-first conversion falls back to the browser when the server route
// fails, as it does on Workers (docs/execution-paths.md), so its copy names
// both; PDF compression has no fallback.
function locationFacts(tool: Tool & { from: string; to: string }) {
  if (runsInBrowser(tool)) {
    return {
      summary: "It runs in your browser, so the file stays on your device.",
      bullet: "Runs in your browser: the file isn't uploaded.",
      faq: "No. The conversion runs in your browser, so the file stays on your device.",
    };
  }
  if (tool.operation === "compress") {
    return {
      summary: "The file is uploaded to the SERP Tools server, which makes the smaller copy.",
      bullet: "The SERP Tools server does the work: the file is uploaded.",
      faq: "Yes. This one uploads the file to the SERP Tools server, which compresses it.",
    };
  }
  return {
    summary: "The page first sends the file to the SERP Tools server, and converts it in your browser if the server can't.",
    bullet: "Tries the SERP Tools server first, then your browser.",
    faq: "Yes, at first. The page sends the file to the SERP Tools server, and converts it in your browser if the server can't.",
  };
}

// A converter or compressor page's article: what the page does, and only
// what holds for every Tool it covers.
function converterArticle(tool: Tool & { from: string; to: string }): InfoArticleSectionData {
  const { fromLabel, toLabel } = buildLabels(tool);
  const location = locationFacts(tool);
  if (tool.operation === "compress") {
    return {
      title: `About ${fromLabel} compression`,
      markdown: [
        `${tool.name} makes a smaller copy of a ${fromLabel} file. ${location.summary}`,
        "How much smaller depends on the file: one that is already compressed may shrink little. If the copy wouldn't be smaller, you get the original back.",
        "**What to expect**",
        `- ${location.bullet}`,
        "- Your original file isn't changed: you download a new copy.",
        "- Several files can be chosen at once; each downloads on its own.",
      ].join("\n\n"),
    };
  }
  return {
    title: `About ${fromLabel} to ${toLabel} conversions`,
    markdown: [
      `${tool.name} converts ${fromLabel} files to ${toLabel}. ${location.summary}`,
      `Use it when a program, site or device needs ${toLabel} and you have ${fromLabel}. Larger files take longer to convert.`,
      "**What to expect**",
      `- ${location.bullet}`,
      "- Your original file isn't changed: you download a new copy.",
      "- Several files can be chosen at once; each downloads on its own.",
    ].join("\n\n"),
  };
}

// The FAQs of a converter or compressor page without curated ones.
export function buildConverterFaqs(tool: Tool): FAQ[] {
  if (!onConverterPage(tool)) return [];
  const { fromLabel, toLabel } = buildLabels(tool);
  const how =
    tool.operation === "compress"
      ? { question: `How do I compress ${fromLabel} files?`, answer: "Choose the file in the compressor above, then download the smaller copy when it's ready." }
      : { question: `How do I convert ${fromLabel} to ${toLabel}?`, answer: "Choose the file in the converter above, then download the result when it finishes." };
  return [
    how,
    { question: "Is my file uploaded?", answer: locationFacts(tool).faq },
    { question: "Do I need to install anything?", answer: "No. The page works in a current web browser, with nothing to install and no sign-up." },
  ];
}

export function buildInfoArticleSection(tool: Tool): InfoArticleSectionData {
  if (onConverterPage(tool)) return converterArticle(tool);
  const { fromLabel, toLabel } = buildLabels(tool);
  const verb = actionVerb(tool);
  let title = `About ${fromLabel} to ${toLabel} conversions`;
  if (tool.operation === "view") {
    title = `About viewing ${fromLabel} files`;
  } else if (tool.operation === "edit") {
    title = `About editing ${fromLabel} files`;
  } else if (tool.operation === "combine") {
    title = `About combining ${fromLabel} files`;
  } else if (tool.operation === "download") {
    title = `About downloading ${fromLabel} files`;
  } else if (isCompressionTool(tool)) {
    title = `About ${fromLabel} compression`;
  }

  let summary = `${tool.name} lets you ${verb} ${fromLabel} to ${toLabel} directly in your browser. Files are processed locally so your data stays on your device.`;
  if (tool.operation === "view") {
    summary = `${tool.name} opens ${fromLabel} files in a fast viewer so you can read them instantly in the browser.`;
  } else if (tool.operation === "edit") {
    summary = `${tool.name} lets you annotate and edit ${fromLabel} files, then download an updated copy without installing software.`;
  } else if (tool.operation === "combine") {
    summary = `${tool.name} combines multiple ${fromLabel} files into a single ${toLabel} file without installing extra software.`;
  } else if (tool.operation === "download") {
    summary = `${tool.name} helps you download ${fromLabel} files quickly and save them to your device.`;
  } else if (isCompressionTool(tool)) {
    summary = `${tool.name} compresses ${fromLabel} files to reduce size while keeping quality intact.`;
  }

  const markdown = [
    summary,
    `Use this tool when you need ${toLabel} files for compatibility, sharing, or smaller sizes. It works on modern desktop and mobile browsers without installing software.`,
    `For best results, start with clean source files. Larger files take longer to process, especially for video or audio conversions.`,
    `**Why use this tool**`,
    `- Runs in the browser with no uploads required.`,
    `- Keeps your original file untouched.`,
    `- Works on desktop and mobile devices.`,
  ].join("\n\n");

  return { title, markdown };
}
