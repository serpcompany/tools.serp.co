"use client";

import { Button } from "@serp-tools/ui/components/button";
import TablePreview from "./TablePreview";
import type { OutputFormat, TableData } from "./types";

// A binary output (Excel, PDF, PNG, JPEG, Avro, Protobuf) as the output
// panel shows it while lib/convert/table-outputs.ts writes it, and once it's
// ready to download.
export type BinaryOutputState =
  | { state: "idle" }
  | { state: "working" }
  | {
      state: "ready";
      buffer: ArrayBuffer;
      notice?: string;
      schema?: string;
      pages?: number;
      previewUrl?: string;
    }
  | { state: "error"; message: string };

type BinaryOutputPreviewProps = {
  format: OutputFormat;
  label: string;
  output: BinaryOutputState;
  table: TableData | null;
  fileName: string;
  schemaFileName: string;
  onDownloadSchema: () => void;
};

// Rows of the table shown under an Excel, PDF or Avro file's summary.
const PREVIEW_ROWS = 100;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function plural(count: number, word: string): string {
  return `${count.toLocaleString("en-US")} ${word}${count === 1 ? "" : "s"}`;
}

export default function BinaryOutputPreview({
  format,
  label,
  output,
  table,
  fileName,
  schemaFileName,
  onDownloadSchema,
}: BinaryOutputPreviewProps) {
  const panel = "min-h-[280px] w-full rounded-lg border shadow-sm";
  let body;
  if (output.state === "idle") {
    body = (
      <div className={`${panel} bg-muted/20 px-4 py-3 text-sm text-muted-foreground`}>
        Paste or upload a table, or edit the grid below, to make the {label} file.
      </div>
    );
  } else if (output.state === "working") {
    body = (
      <div className={`${panel} bg-muted/20 px-4 py-3 text-sm text-muted-foreground`}>Writing the {label} file…</div>
    );
  } else if (output.state === "error") {
    body = (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{output.message}</div>
    );
  } else {
    const parts = [fileName, formatBytes(output.buffer.byteLength)];
    if (output.pages) parts.push(plural(output.pages, "page"));
    if (table) parts.push(`${plural(table.rows.length, "row")}, ${plural(table.headers.length, "column")}`);
    const shown = table && table.rows.length > PREVIEW_ROWS ? { ...table, rows: table.rows.slice(0, PREVIEW_ROWS) } : table;
    body = (
      <div className="space-y-3">
        <p className="text-sm font-medium" data-testid="table-output-summary">
          {parts.join(" · ")}
        </p>
        {output.notice && <p className="text-xs text-amber-700">{output.notice}</p>}
        {output.previewUrl ? (
          <div className={`${panel} max-h-[360px] overflow-auto bg-white p-2`}>
            {/* A blob URL of the image just written; next/image can't optimise it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={output.previewUrl} alt={`The table as ${label}`} className="h-auto max-w-full" />
          </div>
        ) : format === "protobuf" && output.schema ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                The .pb file holds the rows; read it with this schema.
              </p>
              <Button size="sm" variant="outline" onClick={onDownloadSchema}>
                Download .proto
              </Button>
            </div>
            <textarea
              readOnly
              value={output.schema}
              aria-label={`Protobuf schema (${schemaFileName})`}
              className="min-h-[240px] w-full resize-none rounded-lg border bg-muted/20 px-4 py-3 font-mono text-sm shadow-sm"
              spellCheck={false}
            />
          </>
        ) : (
          <>
            {shown !== table && (
              <p className="text-xs text-muted-foreground">
                The first {PREVIEW_ROWS.toLocaleString("en-US")} rows are shown here; the file holds them all.
              </p>
            )}
            <TablePreview table={shown} emptyMessage="The table is empty." />
          </>
        )}
      </div>
    );
  }
  return (
    <div data-testid="table-output" data-state={output.state}>
      {body}
    </div>
  );
}
