"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Button } from "@serp-tools/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@serp-tools/ui/components/card";
import { Badge } from "@serp-tools/ui/components/badge";
import { saveBlob } from "@/components/saveAs";
import { ToolHeroLayout } from "@/components/ToolHeroLayout";
import BinaryOutputPreview, { type BinaryOutputState } from "@/components/table-convert/BinaryOutputPreview";
import DataGridEditor from "@/components/table-convert/DataGridEditor";
import FormatTabs from "@/components/table-convert/FormatTabs";
import TablePreview from "@/components/table-convert/TablePreview";
import ViewToggle from "@/components/table-convert/ViewToggle";
import {
  INPUT_FORMATS,
  OUTPUT_FORMATS,
  SAMPLE_TABLE,
  detectFormatFromFile,
  getLabel,
  getPlaceholder,
  isBinaryOutput,
  outputFileName,
  outputMimeType,
} from "@/components/table-convert/formats";
import { parseInput, serializeOutput } from "@/components/table-convert/convert";
import {
  NO_UPLOAD,
  canOfferOutput,
  nextUpload,
  rewritesInputOnFormatChange,
} from "@/components/table-convert/output-state";
import { InputFormat, OutputFormat, TableData, ViewMode } from "@/components/table-convert/types";
import type { BinaryTableFormat } from "@/lib/convert/table-outputs";

type TableConvertDemoProps = {
  initialInputFormat?: InputFormat;
  initialOutputFormat?: OutputFormat;
  title?: string;
  subtitle?: string;
};

const DEFAULT_TABLE: TableData = SAMPLE_TABLE;
// How long edits settle before a binary output is written again.
const BINARY_DELAY_MS = 300;

export default function TableConvertDemo({
  initialInputFormat = "csv",
  initialOutputFormat = "json",
  title = "Dual Viewer Converter Demo",
  subtitle = "Paste or upload on the left, convert to a target format, and preview on the right.",
}: TableConvertDemoProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [inputFormat, setInputFormat] = useState<InputFormat>(initialInputFormat);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(initialOutputFormat);
  const [inputView, setInputView] = useState<ViewMode>("raw");
  const [outputView, setOutputView] = useState<ViewMode>("raw");
  const [inputText, setInputText] = useState("");
  const [binaryOutput, setBinaryOutput] = useState<BinaryOutputState>({ state: "idle" });
  const [tableData, setTableData] = useState<TableData | null>(DEFAULT_TABLE);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Auto-convert is on.");
  const [dragActive, setDragActive] = useState(false);
  const [hasUserInput, setHasUserInput] = useState(false);
  // The name downloads take, a file being read, and the tickets that let an
  // edit or a newer file win over it (output-state.ts).
  const [{ fileName, upload }, dispatchUpload] = useReducer(nextUpload, NO_UPLOAD);
  const tickets = useRef(0);
  // Counts files loaded, so a file's text is parsed (and its upload ends)
  // even when it matches the text already in the input.
  const [loads, setLoads] = useState(0);

  const inputLabel = getLabel(INPUT_FORMATS, inputFormat);
  const outputLabel = getLabel(OUTPUT_FORMATS, outputFormat);
  const binary = isBinaryOutput(outputFormat);
  const downloadName = outputFileName(fileName, outputFormat);
  const schemaFileName = outputFileName(fileName, "protobuf", "proto");
  const inputPreviewMessage = error ?? "Rendered input preview will appear here.";

  // A text output is serialized from the table on screen as it renders, so
  // it can't lag behind it; binary outputs are written separately, below.
  const serialized = useMemo(
    () => (tableData && !isBinaryOutput(outputFormat) ? serializeOutput(outputFormat, tableData) : null),
    [tableData, outputFormat],
  );
  const outputText = serialized?.text ?? "";
  const outputNotice = !tableData || error
    ? "Waiting for valid input."
    : serialized && !serialized.supported
      ? serialized.notice ?? null
      : null;

  // Only an output written from the input on screen is shown and offered for
  // download: not while a file is read, nor while the input has an error.
  const pageInput = { upload, error, table: tableData, outputFormat };
  const textCurrent = canOfferOutput(pageInput, tableData && serialized ? { table: tableData, format: outputFormat } : null);
  const shownText = textCurrent ? outputText : "";
  const currentBinary = binaryOutput.state === "ready" && canOfferOutput(pageInput, binaryOutput) ? binaryOutput : null;
  const shownBinary: BinaryOutputState = upload
    ? { state: "working", message: `Reading ${upload.name}…` }
    : binaryOutput.state === "ready" && !currentBinary
      ? { state: "working" }
      : binaryOutput;
  const shownNotice = upload && !binary ? `Reading ${upload.name}…` : outputNotice;
  const outputPreviewMessage =
    shownNotice ?? (tableData ? "Rendered output preview will appear here." : "Waiting for valid input.");

  useEffect(() => {
    // A file's upload ends once its text is parsed.
    dispatchUpload({ type: "parsed" });
    if (!hasUserInput && !inputText.trim()) {
      setError(null);
      setTableData(DEFAULT_TABLE);
      return;
    }
    const result = parseInput(inputFormat, inputText);
    if (!result.supported) {
      setError(result.error ?? "Input format not supported.");
      return;
    }
    if (!result.table) {
      setTableData(null);
      setError(result.error ?? null);
      return;
    }
    setError(null);
    setTableData(result.table);
  }, [hasUserInput, inputText, inputFormat, loads]);

  useEffect(() => {
    if (tableData) setStatus(`Auto-converting ${inputLabel} to ${outputLabel}.`);
  }, [tableData, inputLabel, outputLabel]);

  // A binary output is written once edits settle, with its library loaded
  // only now; never for the placeholder table a page opens with, nor while
  // the input shows an error (the table is then the last one that parsed).
  useEffect(() => {
    if (!isBinaryOutput(outputFormat)) return;
    if (!tableData || !hasUserInput || error) {
      setBinaryOutput({ state: "idle" });
      return;
    }
    let cancelled = false;
    setBinaryOutput({ state: "working" });
    const timer = window.setTimeout(async () => {
      try {
        const { writeTableOutput } = await import("@/lib/convert/table-outputs");
        const output = await writeTableOutput(outputFormat as BinaryTableFormat, tableData);
        if (cancelled) return;
        const previewUrl =
          outputFormat === "png" || outputFormat === "jpeg"
            ? URL.createObjectURL(new Blob([output.buffer], { type: outputMimeType(outputFormat) }))
            : undefined;
        setBinaryOutput({ state: "ready", ...output, previewUrl, table: tableData, format: outputFormat });
      } catch (writeError) {
        if (cancelled) return;
        setBinaryOutput({
          state: "error",
          message: writeError instanceof Error ? writeError.message : String(writeError),
        });
      }
    }, BINARY_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [outputFormat, tableData, hasUserInput, error]);

  // An image preview's blob URL is released when the image is replaced.
  useEffect(() => {
    const url = binaryOutput.state === "ready" ? binaryOutput.previewUrl : undefined;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [binaryOutput]);

  function handleInputFormatChange(nextFormat: InputFormat) {
    if (nextFormat === inputFormat) return;
    setInputFormat(nextFormat);
    // Otherwise the parse effect re-parses the text on screen in the new format.
    if (!tableData || !rewritesInputOnFormatChange({ table: tableData, hasUserInput, error })) return;
    const reserialized = serializeOutput(nextFormat, tableData);
    if (reserialized.supported) {
      setInputText(reserialized.text);
      setError(null);
    }
  }

  function handleUploadClick() {
    fileRef.current?.click();
  }

  // Typing, pasting, editing the grid or clearing wins over a file still
  // being read.
  function supersedeUpload() {
    tickets.current += 1;
    dispatchUpload({ type: "cancel" });
  }

  // Until a chosen or dropped file is read and parsed, the output panel says
  // it's being read and offers nothing to download. A file that finishes
  // reading after a newer file or an edit is dropped, and downloads take a
  // file's name only once its text is in the input.
  async function loadFile(file: File) {
    const ticket = ++tickets.current;
    dispatchUpload({ type: "start", name: file.name, ticket });
    let text: string;
    try {
      text = await file.text();
    } catch (readError) {
      if (ticket !== tickets.current) return;
      dispatchUpload({ type: "cancel" });
      setError(`${file.name} couldn't be read: ${readError instanceof Error ? readError.message : String(readError)}`);
      return;
    }
    if (ticket !== tickets.current) return;
    const detected = detectFormatFromFile(file);
    if (detected) setInputFormat(detected);
    setHasUserInput(true);
    setInputText(text);
    setLoads((count) => count + 1);
    dispatchUpload({ type: "read", ticket });
    setStatus(`Loaded ${file.name}.`);
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Choosing the same file again (after a failed read, say) fires change
    // again only once the input is emptied.
    event.target.value = "";
    if (file) void loadFile(file);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  }

  function handleClear() {
    tickets.current += 1;
    dispatchUpload({ type: "clear" });
    setInputText("");
    setError(null);
    setHasUserInput(false);
    setTableData(DEFAULT_TABLE);
    setStatus("Cleared current view.");
  }

  // Protobuf's copyable text is its .proto schema; other binary outputs have
  // none.
  const copyText = binary ? currentBinary?.schema ?? "" : shownText;

  async function handleCopyOutput() {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setStatus(`Copied ${outputLabel} output.`);
    } catch {
      setStatus("Copy failed.");
    }
  }

  // Saves the output under the uploaded file's name (sales.csv becomes
  // sales.json), or table.<extension> for pasted text. A binary output was
  // checked against its format's signature when it was written.
  function handleDownload() {
    if (binary) {
      if (!currentBinary) return;
      saveBlob(new Blob([currentBinary.buffer], { type: outputMimeType(outputFormat) }), downloadName);
    } else {
      if (!shownText) return;
      saveBlob(new Blob([shownText], { type: outputMimeType(outputFormat) }), downloadName);
    }
    setStatus(`Downloaded ${downloadName}.`);
  }

  function handleDownloadSchema() {
    if (!currentBinary?.schema) return;
    saveBlob(new Blob([currentBinary.schema], { type: "text/plain;charset=utf-8" }), schemaFileName);
    setStatus(`Downloaded ${schemaFileName}.`);
  }

  function handleEditorChange(nextTable: TableData) {
    supersedeUpload();
    setHasUserInput(true);
    setTableData(nextTable);
    const asInput = serializeOutput(inputFormat, nextTable);
    if (asInput.supported) {
      setInputText(asInput.text);
      setError(null);
    }
  }

  return (
    <ToolHeroLayout
      adsVisible={false}
      adSlotPrefix="table-convert"
      showAdRail={false}
      showInlineAd={false}
      sectionClassName="bg-gradient-to-b from-gray-50 to-white"
      containerClassName="max-w-7xl px-6 py-16"
      hero={
        <div>
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold tracking-tight mb-4">{title}</h1>
            <p className="text-lg text-gray-600">{subtitle}</p>
          </div>

          <div className="grid grid-cols-1 gap-6 items-start">
            <Card
              className={`min-h-[540px] ${dragActive ? "border-blue-500 ring-2 ring-blue-200" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
            >
              <CardHeader className="border-b">
                <CardTitle>Source</CardTitle>
                <CardDescription>Paste or upload, then switch the input format tab.</CardDescription>
                <CardAction>
                  <Badge variant="secondary">Input</Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormatTabs
                  label="Input format"
                  badgeLabel={inputLabel}
                  options={INPUT_FORMATS}
                  value={inputFormat}
                  onChange={(value) => handleInputFormatChange(value as InputFormat)}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={handleUploadClick}>
                    Upload file
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleClear}>
                    Clear view
                  </Button>
                  <input ref={fileRef} type="file" onChange={handleFileChange} className="hidden" />
                  {(upload?.name ?? fileName) && (
                    <span className="text-xs text-muted-foreground">Selected: {upload?.name ?? fileName}</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Drag and drop a file anywhere in this panel to load it.
                </p>

                <ViewToggle value={inputView} onChange={setInputView} />

                {inputView === "raw" ? (
                  <textarea
                    value={inputText}
                    onChange={(event) => {
                      supersedeUpload();
                      setHasUserInput(true);
                      setInputText(event.target.value);
                    }}
                    placeholder={getPlaceholder(inputFormat)}
                    className={`min-h-[280px] w-full resize-none rounded-lg border bg-background px-4 py-3 font-mono text-sm shadow-sm focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                      error ? "border-red-400" : ""
                    }`}
                    spellCheck={false}
                  />
                ) : (
                  <TablePreview
                    table={tableData}
                    emptyMessage={inputPreviewMessage}
                    format={inputFormat}
                    text={inputText}
                  />
                )}
                {error && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="min-h-[540px]">
              <CardHeader className="border-b">
                <CardTitle>Output</CardTitle>
                <CardDescription>Auto-converts as you type or drop a file.</CardDescription>
                <CardAction>
                  <Badge variant="secondary">Output</Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormatTabs
                  label="Output format"
                  badgeLabel={outputLabel}
                  options={OUTPUT_FORMATS}
                  value={outputFormat}
                  onChange={(value) => setOutputFormat(value as OutputFormat)}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={handleCopyOutput} disabled={!copyText}>
                    Copy
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDownload}
                    disabled={binary ? !currentBinary : !shownText}
                  >
                    Download
                  </Button>
                </div>
                {shownNotice && <p className="text-xs text-muted-foreground">{shownNotice}</p>}
                <div className="text-xs text-muted-foreground">{status}</div>

                {binary ? (
                  <BinaryOutputPreview
                    format={outputFormat}
                    label={outputLabel}
                    output={shownBinary}
                    fileName={downloadName}
                    schemaFileName={schemaFileName}
                    onDownloadSchema={handleDownloadSchema}
                  />
                ) : (
                  <>
                    <ViewToggle value={outputView} onChange={setOutputView} />

                    {outputView === "raw" ? (
                      <textarea
                        readOnly
                        value={shownText}
                        className="min-h-[280px] w-full resize-none rounded-lg border bg-muted/20 px-4 py-3 font-mono text-sm shadow-sm"
                        spellCheck={false}
                      />
                    ) : (
                      <TablePreview
                        table={textCurrent ? tableData : null}
                        emptyMessage={outputPreviewMessage}
                        format={outputFormat}
                        text={shownText}
                      />
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="min-h-[540px]">
              <CardHeader className="border-b">
                <CardTitle>Online table editor</CardTitle>
                <CardDescription>Work directly in a spreadsheet-style grid.</CardDescription>
                <CardAction>
                  <Badge variant="secondary">Editor</Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-4">
                <DataGridEditor tableData={tableData} onChange={handleEditorChange} />
              </CardContent>
            </Card>
          </div>
        </div>
      }
    />
  );
}
