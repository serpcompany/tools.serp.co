"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { InputFormat, OutputFormat, TableData } from "./types";

type TablePreviewProps = {
  table: TableData | null;
  emptyMessage: string;
  format?: InputFormat | OutputFormat;
  text?: string;
};

const containerClassName =
  "min-h-[280px] max-h-[360px] w-full overflow-auto rounded-lg border bg-background shadow-sm";
const markdownBodyClassName =
  "prose prose-sm max-w-none text-foreground " +
  "prose-headings:font-semibold prose-headings:text-slate-900 " +
  "prose-a:text-blue-600 prose-a:underline prose-a:underline-offset-2 " +
  "prose-strong:text-slate-900 prose-em:text-slate-700 " +
  "prose-code:text-slate-800 prose-code:bg-slate-100 prose-code:border prose-code:border-slate-200 " +
  "prose-code:rounded prose-code:px-1 prose-code:py-0.5 " +
  "prose-code:before:content-none prose-code:after:content-none " +
  "prose-pre:bg-slate-50 prose-pre:text-slate-800 prose-pre:border prose-pre:border-slate-200 " +
  "prose-pre:rounded-lg prose-pre:p-4 prose-pre:leading-relaxed " +
  "prose-blockquote:border-slate-200 prose-blockquote:text-slate-600";

export default function TablePreview({
  table,
  emptyMessage,
  format,
  text,
}: TablePreviewProps) {
  if (format === "markdown" && text?.trim()) {
    return (
      <div className={`${containerClassName} bg-white`}>
        <div className="p-4">
          <ReactMarkdown
            className={markdownBodyClassName}
            remarkPlugins={[remarkGfm]}
            components={{
              table: ({ children }) => (
                <table className="min-w-full border-collapse text-sm">{children}</table>
              ),
              thead: ({ children }) => (
                <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  {children}
                </thead>
              ),
              tbody: ({ children }) => (
                <tbody className="[&>tr:nth-child(even)]:bg-slate-50/60">{children}</tbody>
              ),
              th: ({ children }) => (
                <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-700">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border-b border-slate-100 px-3 py-2 align-top text-slate-700">
                  {children}
                </td>
              ),
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
              code: ({ children }) => (
                <code className="rounded border border-slate-200 bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-800">
                  {children}
                </code>
              ),
              pre: ({ children }) => (
                <pre className="overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-800">
                  {children}
                </pre>
              ),
            }}
          >
            {text}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  if (!table) {
    return (
      <div className="min-h-[280px] max-h-[360px] w-full rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground shadow-sm">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={containerClassName}>
      <table className="min-w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-muted/60 text-xs uppercase text-muted-foreground">
          <tr>
            {table.headers.map((header, index) => (
              <th key={`header-${index}`} className="border-b px-3 py-2 text-left font-semibold">
                {header || `Column ${index + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr
              key={`row-${rowIndex}`}
              className={rowIndex % 2 === 0 ? "bg-background" : "bg-muted/20"}
            >
              {table.headers.map((_, cellIndex) => (
                <td key={`cell-${rowIndex}-${cellIndex}`} className="border-b px-3 py-2 align-top">
                  {row[cellIndex] || "-"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
