"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
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
import { Label } from "@serp-tools/ui/components/label";
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
import { parseInput, serializeInput, serializeOutput } from "@/components/table-convert/convert";
import { fileTextFormat, readsAsWorkbook, workbookInput, workbookNotes } from "@/components/table-convert/excel-input";
import { excelPaste } from "@/components/table-convert/excel-paste";
import {
  initialTablePage,
  offeredDownload,
  tablePageReducer,
  type TablePageEvent,
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

// The input, the table on screen and the name downloads take change only
// here, together (output-state.ts).
const nextTablePage = tablePageReducer({ parse: parseInput, serialize: serializeInput, placeholder: DEFAULT_TABLE });

export default function TableConvertDemo({
  initialInputFormat = "csv",
  initialOutputFormat = "json",
  title = "Dual Viewer Converter Demo",
  subtitle = "Paste or upload on the left, convert to a target format, and preview on the right.",
}: TableConvertDemoProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [page, dispatch] = useReducer(nextTablePage, initialInputFormat, (format: InputFormat) =>
    initialTablePage(format, DEFAULT_TABLE),
  );
  const { inputFormat, inputText, hasUserInput, table: tableData, fileName, origin, error, upload, workbook, readOnly } = page;
  const sheetSelectId = useId();
  const readOnlyNoteId = useId();
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(initialOutputFormat);
  const [inputView, setInputView] = useState<ViewMode>("raw");
  const [outputView, setOutputView] = useState<ViewMode>("raw");
  const [binaryOutput, setBinaryOutput] = useState<BinaryOutputState>({ state: "idle" });
  const [status, setStatus] = useState<string>("Auto-convert is on.");
  const [dragActive, setDragActive] = useState(false);
  // Numbers each upload, so a read that finishes after a newer upload or an
  // edit is dropped.
  const tickets = useRef(0);
  // Whether the change being made to the input replaces all of its text (a
  // paste or typing over a select-all, or deleting it all), from the
  // selection just before it. That text is the visitor's own, so a download
  // of it is table.<extension>, not the uploaded file's name.
  const replacesInput = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const watchInput = useCallback((textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;
    inputRef.current = textarea;
    const beforeChange = () => {
      replacesInput.current = textarea.selectionStart === 0 && textarea.selectionEnd === textarea.value.length;
    };
    textarea.addEventListener("beforeinput", beforeChange);
    return () => {
      textarea.removeEventListener("beforeinput", beforeChange);
      if (inputRef.current === textarea) inputRef.current = null;
    };
  }, []);
  // Where the caret goes once a paste the page wrote is in the input.
  const pastedCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const caret = pastedCaret.current;
    pastedCaret.current = null;
    if (caret !== null) inputRef.current?.setSelectionRange(caret, caret);
  }, [inputText]);

  // Cells pasted into the Excel input: when the clipboard's HTML table says
  // its text reads differently from the visitor's reading of it (ditto
  // marks, cells holding line breaks), the page puts the text in its own
  // way (excel-paste.ts); otherwise the browser pastes. Nothing is pasted
  // into read-only text.
  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (inputFormat !== "excel" || readOnly) return;
    const textarea = event.currentTarget;
    const paste = excelPaste({
      plain: event.clipboardData.getData("text/plain"),
      html: event.clipboardData.getData("text/html"),
      value: textarea.value,
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    });
    if (!paste) return;
    event.preventDefault();
    if (paste.value === textarea.value) textarea.setSelectionRange(paste.caret, paste.caret);
    else pastedCaret.current = paste.caret;
    dispatch({ type: "type", text: paste.value, replacesInput: paste.replacesInput, written: paste.written });
  }

  const inputLabel = getLabel(INPUT_FORMATS, inputFormat);
  const outputLabel = getLabel(OUTPUT_FORMATS, outputFormat);
  const binary = isBinaryOutput(outputFormat);
  const downloadName = outputFileName(fileName, outputFormat);
  const schemaFileName = outputFileName(fileName, "protobuf", "proto");
  const inputPreviewMessage = error ?? "Rendered input preview will appear here.";
  // The file being read, or the one the input's text came from: the name a
  // download takes.
  const selectedName = upload?.name ?? fileName;
  // Where read-only text came from: the Excel file, and the sheet shown.
  const readOnlySource = workbook ? `${fileName}, sheet “${workbook.sheets[workbook.sheet]?.name}”` : fileName;

  // A text output is serialized from the table on screen as it renders, so
  // it can't lag behind it; binary outputs are written separately, below.
  const serialized = useMemo(
    () => (tableData && !isBinaryOutput(outputFormat) ? serializeOutput(outputFormat, tableData) : null),
    [tableData, outputFormat],
  );
  const outputNotice = !tableData || error
    ? "Waiting for valid input."
    : serialized && !serialized.supported
      ? serialized.notice ?? null
      : null;

  // Only an output written from the table on screen is shown and offered for
  // download, under the name of the file that table came from: not while a
  // file is read, nor while the input has an error.
  const textOffer = offeredDownload(
    page,
    outputFormat,
    tableData && serialized ? { table: tableData, format: outputFormat, text: serialized.text } : null,
  );
  const binaryOffer = offeredDownload(page, outputFormat, binaryOutput.state === "ready" ? binaryOutput : null);
  const shownText = textOffer?.output.text ?? "";
  const currentBinary = binaryOffer?.output ?? null;
  const shownBinary: BinaryOutputState = upload
    ? { state: "working", message: `Reading ${upload.name}…` }
    : binaryOutput.state === "ready" && !currentBinary
      ? { state: "working" }
      : binaryOutput;
  const shownNotice = upload && !binary ? `Reading ${upload.name}…` : outputNotice;
  const outputPreviewMessage =
    shownNotice ?? (tableData ? "Rendered output preview will appear here." : "Waiting for valid input.");

  useEffect(() => {
    if (tableData) setStatus(`Auto-converting ${inputLabel} to ${outputLabel}.`);
  }, [tableData, inputLabel, outputLabel]);

  // A binary output is written once edits settle, with its library loaded
  // only now; never for the placeholder table a page opens with, nor while
  // the input has no table.
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

  function handleUploadClick() {
    fileRef.current?.click();
  }

  // Until a chosen or dropped file is read and parsed, the output panel says
  // it's being read and offers nothing to download. Typing, pasting, editing
  // the grid, choosing a sheet, clearing or a newer file wins over it (its
  // read is dropped). An Excel workbook is read in a worker, its reader
  // loaded only now, into the text an Excel input holds for each sheet.
  async function loadFile(file: File) {
    const ticket = ++tickets.current;
    dispatch({ type: "upload", name: file.name, ticket });
    let event: TablePageEvent;
    try {
      const format = detectFormatFromFile(file);
      const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      if (readsAsWorkbook(file.name, format, inputFormat, head)) {
        const { readWorkbookTextInWorker } = await import("@/lib/convert/xlsx-workbook");
        const read = await readWorkbookTextInWorker(await file.arrayBuffer());
        event = { type: "readWorkbook", ticket, workbook: workbookInput(read) };
      } else {
        // An Excel file that is text is read-only once read, as a workbook is.
        const text = await file.text();
        event = { type: "read", ticket, text, format: fileTextFormat(format, text), fromExcel: format === "excel" };
      }
    } catch (readError) {
      const reason = readError instanceof Error ? readError.message : String(readError);
      event = { type: "readFailed", ticket, error: `${file.name} couldn't be read: ${reason}` };
    }
    dispatch(event);
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
    dispatch({ type: "clear" });
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

  // Saves the output under the name of the file the input's text came from
  // (sales.csv becomes sales.json), or table.<extension> for pasted text. A
  // binary output was checked against its format's signature when it was
  // written.
  function handleDownload() {
    const mimeType = outputMimeType(outputFormat);
    let name: string;
    if (binary) {
      if (!binaryOffer) return;
      saveBlob(new Blob([binaryOffer.output.buffer], { type: mimeType }), binaryOffer.name);
      name = binaryOffer.name;
    } else {
      if (!textOffer?.output.text) return;
      saveBlob(new Blob([textOffer.output.text], { type: mimeType }), textOffer.name);
      name = textOffer.name;
    }
    setStatus(`Downloaded ${name}.`);
  }

  function handleDownloadSchema() {
    if (!currentBinary?.schema) return;
    saveBlob(new Blob([currentBinary.schema], { type: "text/plain;charset=utf-8" }), schemaFileName);
    setStatus(`Downloaded ${schemaFileName}.`);
  }

  // The grid reports which table it was showing; an edit of an earlier table
  // is dropped.
  function handleEditorChange(nextTable: TableData, editedOrigin: number) {
    dispatch({ type: "editGrid", table: nextTable, origin: editedOrigin });
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
                  onChange={(value) => dispatch({ type: "inputFormat", format: value as InputFormat })}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={handleUploadClick}>
                    Upload file
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleClear}>
                    Clear view
                  </Button>
                  <input ref={fileRef} type="file" onChange={handleFileChange} className="hidden" />
                  {selectedName && <span className="text-xs text-muted-foreground">Selected: {selectedName}</span>}
                </div>
                {workbook && inputFormat === "excel" && (
                  <div className="space-y-1 text-xs text-muted-foreground" data-testid="excel-sheet">
                    <div className="flex flex-wrap items-center gap-2">
                      {workbook.sheets.length > 1 && (
                        <>
                          <Label htmlFor={sheetSelectId} className="text-xs">
                            Sheet
                          </Label>
                          <select
                            id={sheetSelectId}
                            value={workbook.sheet}
                            onChange={(event) => dispatch({ type: "sheet", sheet: Number(event.target.value) })}
                            className="h-8 max-w-[16rem] rounded-md border border-input bg-background px-2 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          >
                            {workbook.sheets.map((sheet, index) => (
                              <option key={index} value={index}>
                                {sheet.name}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                      <span>
                        Showing sheet “{workbook.sheets[workbook.sheet]?.name}”
                        {workbook.sheets.length > 1
                          ? `, ${workbook.sheet + 1} of the ${workbook.sheets.length} sheets with values.`
                          : "."}
                      </span>
                    </div>
                    {workbookNotes(workbook).map((note) => (
                      <p key={note}>{note}</p>
                    ))}
                  </div>
                )}
                {/* After an Excel upload the input's text is read-only: cells
                    are edited in the grid, and Clear makes the input the
                    visitor's again (output-state.ts). */}
                {readOnly && (
                  <p id={readOnlyNoteId} className="text-xs text-muted-foreground" data-testid="input-read-only">
                    <span className="font-medium text-foreground">Read-only:</span> the text from {readOnlySource}. Edit
                    cells in the online table editor below, or press Clear view to paste or type your own data.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Drag and drop a file anywhere in this panel to load it.
                </p>

                <ViewToggle value={inputView} onChange={setInputView} />

                {inputView === "raw" ? (
                  <textarea
                    ref={watchInput}
                    value={inputText}
                    readOnly={readOnly}
                    aria-label={`${inputLabel} input`}
                    aria-describedby={readOnly ? readOnlyNoteId : undefined}
                    data-testid="table-input"
                    onPaste={handlePaste}
                    onChange={(event) => {
                      dispatch({ type: "type", text: event.target.value, replacesInput: replacesInput.current });
                      replacesInput.current = false;
                    }}
                    placeholder={getPlaceholder(inputFormat)}
                    className={`min-h-[280px] w-full resize-none rounded-lg border px-4 py-3 font-mono text-sm shadow-sm focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                      readOnly ? "bg-muted/40 text-foreground/80" : "bg-background"
                    } ${error ? "border-red-400" : ""}`}
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
                <div className="text-xs text-muted-foreground" role="status">{status}</div>

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
                        table={textOffer ? tableData : null}
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
                <DataGridEditor tableData={tableData} origin={origin} onChange={handleEditorChange} />
              </CardContent>
            </Card>
          </div>
        </div>
      }
    />
  );
}
