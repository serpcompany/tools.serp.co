"use client";

import { useEffect, useRef, useState } from "react";
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
import { ToolHeroLayout } from "@/components/ToolHeroLayout";
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
} from "@/components/table-convert/formats";
import { parseInput, serializeOutput } from "@/components/table-convert/convert";
import { InputFormat, OutputFormat, TableData, ViewMode } from "@/components/table-convert/types";
import { createBrowserTableWorkflow } from "@/lib/table-browser-workflow";
import { tableInputContracts } from "@/lib/table-operation-policy";
import type { WorkflowDelivery } from "@/lib/tool-workflow";

type TableConvertDemoProps = {
  toolId?: string;
  initialInputFormat?: InputFormat;
  initialOutputFormat?: OutputFormat;
  title?: string;
  subtitle?: string;
};

const DEFAULT_TABLE: TableData = SAMPLE_TABLE;

export default function TableConvertDemo({
  toolId,
  initialInputFormat = "csv",
  initialOutputFormat = "json",
  title = "Dual Viewer Converter Demo",
  subtitle = "Paste or upload on the left, convert to a target format, and preview on the right.",
}: TableConvertDemoProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [{ workflow, deliveries }] = useState(createBrowserTableWorkflow);
  const [inputFormat, setInputFormat] = useState<InputFormat>(initialInputFormat);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(initialOutputFormat);
  const [inputView, setInputView] = useState<ViewMode>("raw");
  const [outputView, setOutputView] = useState<ViewMode>("raw");
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [outputNotice, setOutputNotice] = useState<string | null>(null);
  const [tableData, setTableData] = useState<TableData | null>(DEFAULT_TABLE);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [inputBytes, setInputBytes] = useState<Uint8Array | null>(null);
  const [delivery, setDelivery] = useState<WorkflowDelivery | null>(null);
  const [status, setStatus] = useState<string>("Ready to convert.");
  const [isConverting, setIsConverting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [hasUserInput, setHasUserInput] = useState(false);

  const inputLabel = getLabel(INPUT_FORMATS, inputFormat);
  const outputLabel = getLabel(OUTPUT_FORMATS, outputFormat);
  const inputPreviewMessage = error ?? "Rendered input preview will appear here.";
  const outputPreviewMessage =
    outputNotice ??
    (tableData ? "Rendered output preview will appear here." : "Waiting for valid input.");

  useEffect(() => {
    if (inputFormat === "excel" && inputBytes) {
      setError(null);
      setTableData(null);
      return;
    }
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
  }, [hasUserInput, inputText, inputFormat, inputBytes]);

  function handleInputFormatChange(nextFormat: InputFormat, reserialize = true) {
    if (nextFormat === inputFormat) return;
    setInputFormat(nextFormat);
    setInputBytes(null);
    if (!tableData || !reserialize || !hasUserInput) return;
    const serialized = serializeOutput(nextFormat, tableData);
    if (serialized.supported) {
      setInputText(serialized.text);
      setError(null);
    }
  }

  function handleUploadClick() {
    fileRef.current?.click();
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const detected = detectFormatFromFile(file);
    if (detected && detected !== inputFormat) {
      handleInputFormatChange(detected, false);
    }
    setFileName(file.name);
    setHasUserInput(true);
    const bytes = new Uint8Array(await file.arrayBuffer());
    setInputBytes(bytes);
    setInputText(detected === "excel" ? "XLSX workbook loaded." : new TextDecoder().decode(bytes));
    setStatus(`Loaded ${file.name}.`);
  }

  async function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    const detected = detectFormatFromFile(file);
    if (detected && detected !== inputFormat) {
      handleInputFormatChange(detected, false);
    }
    setFileName(file.name);
    setHasUserInput(true);
    const bytes = new Uint8Array(await file.arrayBuffer());
    setInputBytes(bytes);
    setInputText(detected === "excel" ? "XLSX workbook loaded." : new TextDecoder().decode(bytes));
    setStatus(`Loaded ${file.name}.`);
  }

  function handleClear() {
    setInputText("");
    setFileName(null);
    setInputBytes(null);
    setDelivery(null);
    setError(null);
    setHasUserInput(false);
    setTableData(DEFAULT_TABLE);
    setOutputText("");
    setOutputNotice(null);
    setStatus("Cleared current view.");
  }

  async function handleCopyOutput() {
    if (!outputText) return;
    try {
      await navigator.clipboard.writeText(outputText);
      setStatus(`Copied ${outputLabel} output.`);
    } catch {
      setStatus("Copy failed.");
    }
  }

  function handleDownload() {
    if (!delivery) return;
    deliveries.download(delivery);
    setStatus(`Downloaded ${outputLabel} output.`);
  }

  async function handleConvert() {
    if ((!inputText.trim() && !inputBytes) || isConverting) return;
    setIsConverting(true);
    setError(null);
    setOutputNotice(null);
    setDelivery(null);
    const selectedToolId =
      inputFormat === initialInputFormat && outputFormat === initialOutputFormat && toolId
        ? toolId
        : `${inputFormat}-to-${outputFormat}`;
    const bytes = inputBytes ?? new TextEncoder().encode(inputText);
    const mimeType = tableInputContracts[inputFormat].mimeTypes[0]!;
    try {
      const outcome = await workflow.run(
        {
          toolId: selectedToolId,
          input: {
            kind: "file",
            media: {
              name: fileName ?? `table.${inputFormat}`,
              format: inputFormat,
              mimeType,
              bytes,
            },
          },
        },
        {
          observe: ({ phase }) => setStatus(`${phase[0]?.toUpperCase()}${phase.slice(1)}…`),
        },
      );
      if (outcome.status !== "succeeded") {
        const message =
          outcome.status === "failed" ? outcome.error.message : "Conversion was cancelled.";
        setError(message);
        setOutputText("");
        setStatus(message);
        return;
      }
      const nextDelivery = outcome.results[0];
      const media = nextDelivery ? deliveries.get(nextDelivery.deliveryId) : undefined;
      if (!nextDelivery || !media) {
        throw new TypeError("Workflow delivery is unavailable");
      }
      setDelivery(nextDelivery);
      if (
        media.mimeType.startsWith("text/") ||
        media.mimeType.includes("json") ||
        media.mimeType.includes("yaml") ||
        media.mimeType.includes("sql") ||
        media.mimeType.includes("xml")
      ) {
        setOutputText(new TextDecoder().decode(media.bytes));
      } else {
        setOutputText("");
        setOutputNotice(`${outputLabel} binary output is verified and ready to download.`);
      }
      setStatus(`Converted ${inputLabel} to ${outputLabel}.`);
    } catch (conversionError) {
      const message =
        conversionError instanceof Error ? conversionError.message : String(conversionError);
      setError(message);
      setStatus(message);
    } finally {
      setIsConverting(false);
    }
  }

  function handleEditorChange(nextTable: TableData) {
    setHasUserInput(true);
    setInputBytes(null);
    setTableData(nextTable);
    const serialized = serializeOutput(inputFormat, nextTable);
    if (serialized.supported) {
      setInputText(serialized.text);
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
                <CardDescription>
                  Paste or upload, then switch the input format tab.
                </CardDescription>
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
                  {fileName && (
                    <span className="text-xs text-muted-foreground">Selected: {fileName}</span>
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
                      setHasUserInput(true);
                      setInputBytes(null);
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
                <CardDescription>Runs through the verified shared workflow.</CardDescription>
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
                  onChange={(value) => {
                    setOutputFormat(value as OutputFormat);
                    setDelivery(null);
                    setOutputText("");
                    setOutputNotice(null);
                  }}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={handleConvert} disabled={isConverting}>
                    {isConverting ? "Converting…" : "Convert"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCopyOutput}
                    disabled={!outputText}
                  >
                    Copy
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleDownload} disabled={!delivery}>
                    Download
                  </Button>
                </div>
                {outputNotice && <p className="text-xs text-muted-foreground">{outputNotice}</p>}
                <div className="text-xs text-muted-foreground">{status}</div>

                <ViewToggle value={outputView} onChange={setOutputView} />

                {outputView === "raw" ? (
                  <textarea
                    readOnly
                    value={outputText}
                    className="min-h-[280px] w-full resize-none rounded-lg border bg-muted/20 px-4 py-3 font-mono text-sm shadow-sm"
                    spellCheck={false}
                  />
                ) : (
                  <TablePreview
                    table={tableData}
                    emptyMessage={outputPreviewMessage}
                    format={outputFormat}
                    text={outputText}
                  />
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
