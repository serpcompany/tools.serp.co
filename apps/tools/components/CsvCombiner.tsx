"use client";

import { useRef, useState } from "react";
import { Card } from "@serp-tools/ui/components/card";
import { Button } from "@serp-tools/ui/components/button";
import { Badge } from "@serp-tools/ui/components/badge";
import { saveBlob } from "@/components/saveAs";
import { ToolHeroLayout } from "@/components/ToolHeroLayout";
import { ToolVideoPanel } from "@/components/ToolVideoPanel";
import { beginToolRun } from "@/lib/telemetry";

type Props = {
  toolId?: string;
  videoEmbedId?: string;
};

type FileEntry = {
  name: string;
  size: number;
};

type ParsedCsv = {
  headers: string[];
  rows: string[][];
};

const DELIMITERS = [",", ";", "\t", "|"];

function detectDelimiter(line: string) {
  const scores = DELIMITERS.map((delimiter) => ({
    delimiter,
    count: line.split(delimiter).length - 1,
  }));
  scores.sort((a, b) => b.count - a.count);
  return scores[0]?.count ? scores[0].delimiter : ",";
}

function parseCsvLine(line: string, delimiter: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      const nextChar = line[i + 1];
      if (inQuotes && nextChar === '"') {
        current += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function parseCsv(text: string): ParsedCsv {
  const cleaned = text.replace(/^\uFEFF/, "").trim();
  if (!cleaned) {
    return { headers: [], rows: [] };
  }

  const lines = cleaned.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const delimiter = detectDelimiter(lines[0] ?? "");
  const headers = parseCsvLine(lines[0] ?? "", delimiter).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => parseCsvLine(line, delimiter));

  return { headers, rows };
}

function escapeCsv(value: string) {
  if (value.includes(",") || value.includes("\n") || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function mergeCsvFiles(parsedFiles: ParsedCsv[]) {
  const headerIndex = new Map<string, number>();
  const combinedHeaders: string[] = [];
  const combinedRows: string[][] = [];

  parsedFiles.forEach(({ headers, rows }) => {
    headers.forEach((header) => {
      if (!headerIndex.has(header)) {
        headerIndex.set(header, combinedHeaders.length);
        combinedHeaders.push(header);
        combinedRows.forEach((row) => row.push(""));
      }
    });

    rows.forEach((row) => {
      const output = new Array(combinedHeaders.length).fill("");
      headers.forEach((header, index) => {
        const targetIndex = headerIndex.get(header);
        if (targetIndex === undefined) return;
        output[targetIndex] = row[index] ?? "";
      });
      combinedRows.push(output);
    });
  });

  const csvLines = [
    combinedHeaders.map(escapeCsv).join(","),
    ...combinedRows.map((row) => row.map((value) => escapeCsv(value ?? "")).join(",")),
  ];

  return {
    csv: csvLines.join("\n"),
    rows: combinedRows.length,
    columns: combinedHeaders.length,
  };
}

export default function CsvCombiner({ toolId, videoEmbedId }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [output, setOutput] = useState("");
  const [stats, setStats] = useState({ rows: 0, columns: 0 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [adsVisible, setAdsVisible] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);

  function onPick() {
    inputRef.current?.click();
  }

  function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const next = Array.from(list);
    if (!adsVisible) setAdsVisible(true);
    if (!videoPlaying) setVideoPlaying(true);
    setSelectedFiles(next);
    setFiles(next.map((file) => ({ name: file.name, size: file.size })));
    setOutput("");
    setStats({ rows: 0, columns: 0 });
    setError("");
  }

  async function combineCsv() {
    if (selectedFiles.length === 0) {
      setError("Please add at least two CSV files.");
      return;
    }

    if (!videoPlaying) setVideoPlaying(true);
    if (selectedFiles.length < 2) {
      setError("Please add at least two CSV files.");
      return;
    }

    setBusy(true);
    setError("");

    const run = beginToolRun({
      toolId: toolId ?? "csv-combiner",
      from: "csv",
      to: "csv",
      inputBytes: selectedFiles.reduce((sum, file) => sum + file.size, 0),
      metadata: { fileCount: selectedFiles.length },
    });

    try {
      const parsedFiles = await Promise.all(
        selectedFiles.map(async (file) => {
          const text = await file.text();
          return parseCsv(text);
        })
      );

      if (parsedFiles.some((parsed) => parsed.headers.length === 0)) {
        throw new Error("One or more files are empty or invalid.");
      }

      const merged = mergeCsvFiles(parsedFiles);
      setOutput(merged.csv);
      setStats({ rows: merged.rows, columns: merged.columns });
      run.finishSuccess({
        outputBytes: new Blob([merged.csv]).size,
        metadata: { rows: merged.rows, columns: merged.columns },
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to combine CSV files.");
      run.finishFailure({ errorCode: "combine_failed" });
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv() {
    if (!output) return;
    const blob = new Blob([output], { type: "text/csv" });
    saveBlob(blob, "combined.csv");
  }

  const adSlotPrefix = toolId ?? "csv-combiner";

  return (
    <ToolHeroLayout
      adsVisible={adsVisible}
      adSlotPrefix={adSlotPrefix}
      sectionClassName="bg-gradient-to-b from-gray-50 to-white"
      containerClassName="max-w-7xl px-6 py-16"
      hero={
        <div className="mx-auto max-w-4xl">
          <div className="text-center mb-10">
            <h1 className="text-4xl font-bold tracking-tight mb-4">CSV Combiner</h1>
            <p className="mx-auto max-w-2xl text-lg text-gray-600">
              Merge multiple CSV files into one clean dataset without uploads.
            </p>
          </div>

          <Card className="overflow-hidden border-gray-200 shadow-sm">
            <div className="border-b border-gray-200 bg-white px-6 py-5 sm:px-8">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.18em] text-gray-500">
                    Step 1
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-gray-900">
                    Add the CSV files you want to merge
                  </h2>
                  <p className="mt-2 text-sm text-gray-600">
                    We align matching headers automatically and keep every row in one combined
                    download.
                  </p>
                </div>
                {files.length > 0 && (
                  <Badge variant="secondary" className="self-start sm:self-auto">
                    {files.length} files selected
                  </Badge>
                )}
              </div>
            </div>

            <div className="space-y-6 bg-white px-6 py-6 sm:px-8">
              <div
                className="cursor-pointer rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50/70 p-8 text-center transition-colors hover:border-gray-400 hover:bg-white"
                onClick={onPick}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleFiles(e.dataTransfer.files);
                }}
                data-testid="csv-combiner-dropzone"
              >
                <p className="text-base font-medium text-gray-900">
                  Drop CSV files here or click to select
                </p>
                <p className="mt-2 text-sm text-gray-600">
                  Add at least two files. We merge rows and align columns by header name.
                </p>
              </div>

              <input
                ref={inputRef}
                type="file"
                multiple
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
                data-testid="csv-combiner-input"
              />

              {files.length > 0 && (
                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900">Selected files</h3>
                    <span className="text-xs uppercase tracking-[0.14em] text-gray-500">
                      Ready to combine
                    </span>
                  </div>
                  <ul className="space-y-2 text-sm text-gray-600">
                    {files.map((file) => (
                      <li
                        key={file.name}
                        className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2"
                      >
                        <span className="truncate pr-4 font-medium text-gray-800">{file.name}</span>
                        <span className="shrink-0 text-gray-500">
                          {Math.round(file.size / 1024)} KB
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                  {error}
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  onClick={combineCsv}
                  disabled={busy}
                  className="sm:min-w-48"
                  data-testid="csv-combiner-run"
                >
                  {busy ? "Combining..." : "Combine CSV Files"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setFiles([]);
                    setSelectedFiles([]);
                    setOutput("");
                    setStats({ rows: 0, columns: 0 });
                    setError("");
                    if (inputRef.current) inputRef.current.value = "";
                  }}
                >
                  Clear
                </Button>
                <p className="text-sm text-gray-500 sm:ml-auto">
                  No uploads. Everything stays in your browser.
                </p>
              </div>

              {output && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-700">
                        Step 2
                      </p>
                      <h3 className="mt-2 text-xl font-semibold text-emerald-950">
                        Combined successfully
                      </h3>
                      <p className="mt-2 text-sm text-emerald-900/80">
                        Your merged file is ready to download.
                      </p>
                    </div>
                    <Badge variant="secondary" className="self-start bg-white text-emerald-800">
                      {stats.rows} rows · {stats.columns} columns
                    </Badge>
                  </div>

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <Button
                      onClick={downloadCsv}
                      disabled={!output}
                      variant="secondary"
                      className="bg-emerald-900 text-white hover:bg-emerald-800"
                      data-testid="csv-combiner-download"
                    >
                      Download Combined CSV
                    </Button>
                    <p className="text-sm text-emerald-900/80">
                      The combined file is generated locally and downloaded as <code>combined.csv</code>.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {videoEmbedId && (
            <div className="mt-10">
              <div className="mb-4 text-center">
                <p className="text-sm font-medium uppercase tracking-[0.18em] text-gray-500">
                  Walkthrough
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-gray-900">
                  Watch the CSV combiner in action
                </h2>
              </div>
              <ToolVideoPanel embedId={videoEmbedId} autoplay={videoPlaying} />
            </div>
          )}
        </div>
      }
    />
  );
}
