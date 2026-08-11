"use client";

import { useEffect, useState } from "react";
import { Button } from "@serp-tools/ui/components/button";
import { Card } from "@serp-tools/ui/components/card";
import { Badge } from "@serp-tools/ui/components/badge";
import { useSpecializedToolWorkflow } from "@/lib/useSpecializedToolWorkflow";

const TOOL_ID = "html-to-markdown";

const SAMPLE_HTML = `<h1>Welcome to HTML to Markdown</h1>
<p>This tool converts <strong>HTML</strong> to <em>Markdown</em> right in your browser.</p>
<h2>Features</h2>
<ul>
  <li>Instant, client-side conversion</li>
  <li>Supports headings, lists, links, and more</li>
  <li>Powered by <a href="https://github.com/kreuzberg-dev/html-to-markdown">html-to-markdown</a></li>
</ul>
<blockquote><p>Paste any HTML on the left and get clean Markdown on the right.</p></blockquote>`;

export default function HtmlToMarkdownConverter() {
  const [html, setHtml] = useState(SAMPLE_HTML);
  const [markdown, setMarkdown] = useState("");
  const [copied, setCopied] = useState(false);
  const workflow = useSpecializedToolWorkflow();
  const { clear, delivery, download, error, outcome, scheduleInteraction, text } = workflow;

  useEffect(() => {
    if (!html.trim()) {
      setMarkdown("");
      clear();
      return;
    }
    scheduleInteraction(TOOL_ID, "html", "text/html", html, 250);
  }, [clear, html, scheduleInteraction]);

  useEffect(() => {
    setMarkdown(text(delivery) ?? "");
  }, [delivery, text]);

  const wasmReady = outcome?.status === "succeeded";

  function handleCopy() {
    navigator.clipboard.writeText(markdown).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleDownload() {
    download(delivery);
  }

  function handleClear() {
    setHtml("");
    setMarkdown("");
    clear();
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      setHtml(text);
    } catch {
      // clipboard access denied – ignore
    }
  }

  const htmlLines = html ? html.split("\n").length : 0;
  const htmlChars = html.length;
  const mdLines = markdown ? markdown.split("\n").length : 0;
  const mdChars = markdown.length;

  return (
    <section className="w-full bg-gradient-to-b from-gray-50 to-white py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold tracking-tight mb-3">HTML to Markdown Converter</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Paste HTML on the left and get clean Markdown on the right — instantly, in your browser.
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 text-center">
            {error}
          </div>
        )}

        {/* Editor panels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
          {/* HTML Input */}
          <Card className="flex flex-col p-0 overflow-hidden shadow-sm">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50/80">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-800 text-sm">HTML Input</span>
                {htmlChars > 0 && (
                  <Badge variant="secondary" className="font-mono text-xs">
                    {htmlLines} lines · {htmlChars.toLocaleString()} chars
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handlePaste}
                  className="h-8 px-3 text-xs font-medium"
                >
                  Paste
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleClear}
                  className="h-8 px-3 text-xs font-medium text-gray-500 hover:text-gray-800"
                >
                  Clear
                </Button>
              </div>
            </div>
            {/* Textarea */}
            <textarea
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              placeholder="Paste your HTML here…"
              className="flex-1 w-full min-h-[480px] lg:min-h-[600px] p-5 font-mono text-sm leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 bg-white text-gray-900 placeholder:text-gray-400"
              data-testid="html-input"
              spellCheck={false}
            />
          </Card>

          {/* Markdown Output */}
          <Card className="flex flex-col p-0 overflow-hidden shadow-sm">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50/80">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-800 text-sm">
                  Markdown Output
                </span>
                {!wasmReady ? (
                  <Badge variant="secondary" className="text-xs animate-pulse">
                    Loading…
                  </Badge>
                ) : mdChars > 0 ? (
                  <Badge variant="secondary" className="font-mono text-xs">
                    {mdLines} lines · {mdChars.toLocaleString()} chars
                  </Badge>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopy}
                  disabled={!markdown}
                  className="h-8 px-3 text-xs font-medium"
                >
                  {copied ? "✓ Copied" : "Copy"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDownload}
                  disabled={!markdown}
                  className="h-8 px-3 text-xs font-medium"
                >
                  Download .md
                </Button>
              </div>
            </div>
            {/* Textarea */}
            <textarea
              value={markdown}
              readOnly
              placeholder={wasmReady ? "Markdown will appear here…" : "Loading converter…"}
              className="flex-1 w-full min-h-[480px] lg:min-h-[600px] p-5 font-mono text-sm leading-relaxed resize-none focus:outline-none bg-gray-50/50 text-gray-800 placeholder:text-gray-400 cursor-default"
              data-testid="markdown-output"
              spellCheck={false}
            />
          </Card>
        </div>

        {/* Privacy note */}
        <p className="mt-4 text-center text-xs text-gray-400">
          🔒 All conversion runs locally in your browser via WebAssembly — your HTML is never uploaded.
        </p>
      </div>
    </section>
  );
}
