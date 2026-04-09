"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@serp-tools/ui/components/button";
import { Card } from "@serp-tools/ui/components/card";
import { beginToolRun } from "@/lib/telemetry";

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

type ConvertFn = (html: string, options: null) => { content: string | null };

export default function HtmlToMarkdownConverter() {
  const [html, setHtml] = useState(SAMPLE_HTML);
  const [markdown, setMarkdown] = useState("");
  const [wasmReady, setWasmReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const convertRef = useRef<ConvertFn | null>(null);
  const telemetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTelemetryAt = useRef(0);

  // Load the WASM module once on mount
  useEffect(() => {
    let cancelled = false;
    async function loadWasm() {
      try {
        const mod = await import("@kreuzberg/html-to-markdown-wasm/dist-web");
        await mod.default();
        if (!cancelled) {
          convertRef.current = mod.convert as ConvertFn;
          setWasmReady(true);
        }
      } catch (err) {
        if (!cancelled) {
          setError("Failed to load converter. Please refresh and try again.");
          console.error("WASM load error:", err);
        }
      }
    }
    loadWasm();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-convert whenever html changes and WASM is ready
  useEffect(() => {
    if (!wasmReady || !convertRef.current) return;
    try {
      const result = convertRef.current(html, null);
      setMarkdown(result.content ?? "");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversion failed");
      setMarkdown("");
    }
  }, [html, wasmReady]);

  // Debounced telemetry
  useEffect(() => {
    if (!html.trim() || !markdown) return;
    if (telemetryTimer.current) clearTimeout(telemetryTimer.current);
    telemetryTimer.current = setTimeout(() => {
      const now = Date.now();
      if (now - lastTelemetryAt.current < 10_000) return;
      const run = beginToolRun({
        toolId: TOOL_ID,
        inputBytes: new Blob([html]).size,
        metadata: { htmlLength: html.length },
      });
      run.finishSuccess({ outputBytes: new Blob([markdown]).size });
      lastTelemetryAt.current = now;
    }, 800);
    return () => {
      if (telemetryTimer.current) clearTimeout(telemetryTimer.current);
    };
  }, [html, markdown]);

  function handleCopy() {
    navigator.clipboard.writeText(markdown).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleDownload() {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "converted.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleClear() {
    setHtml("");
    setMarkdown("");
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      setHtml(text);
    } catch {
      // clipboard access denied – ignore
    }
  }

  return (
    <section className="w-full bg-gradient-to-b from-gray-50 to-white py-16">
      <div className="mx-auto max-w-7xl px-6">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold tracking-tight mb-3">HTML to Markdown Converter</h1>
          <p className="text-lg text-gray-600">
            Paste HTML on the left and get clean Markdown on the right — instantly, in your browser.
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 text-center">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* HTML Input */}
          <Card className="flex flex-col p-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50">
              <span className="text-sm font-semibold text-gray-700">HTML Input</span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handlePaste}
                  className="h-7 px-2 text-xs"
                >
                  Paste
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleClear}
                  className="h-7 px-2 text-xs"
                >
                  Clear
                </Button>
              </div>
            </div>
            <textarea
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              placeholder="Paste your HTML here…"
              className="flex-1 w-full h-96 p-4 font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              data-testid="html-input"
              spellCheck={false}
            />
          </Card>

          {/* Markdown Output */}
          <Card className="flex flex-col p-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50">
              <span className="text-sm font-semibold text-gray-700">
                Markdown Output
                {!wasmReady && (
                  <span className="ml-2 text-xs font-normal text-gray-400">(loading…)</span>
                )}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleCopy}
                  disabled={!markdown}
                  className="h-7 px-2 text-xs"
                >
                  {copied ? "Copied!" : "Copy"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleDownload}
                  disabled={!markdown}
                  className="h-7 px-2 text-xs"
                >
                  Download .md
                </Button>
              </div>
            </div>
            <textarea
              value={markdown}
              readOnly
              placeholder={wasmReady ? "Markdown will appear here…" : "Loading converter…"}
              className="flex-1 w-full h-96 p-4 font-mono text-sm resize-none focus:outline-none bg-white text-gray-800"
              data-testid="markdown-output"
              spellCheck={false}
            />
          </Card>
        </div>
      </div>
    </section>
  );
}
