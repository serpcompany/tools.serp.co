// A table drawn as a PNG or JPEG (#249): a grid on a white canvas with a
// shaded header row, in the system's sans-serif font, so any script the
// browser can show comes out. The canvas is at most 4096 px a side (Safari's
// limit, as for pdf.js pages); a table that doesn't fit shows its first rows
// and columns, and the image and the page say how many.

import type { TableData } from "./table-data.ts";

// Drawn at twice its size in CSS pixels, so text stays sharp when zoomed.
export const IMAGE_SCALE = 2;
export const IMAGE_MAX_SIDE = 4096;
const MAX_CSS = IMAGE_MAX_SIDE / IMAGE_SCALE;
const FONT_SIZE = 14;
const LINE_HEIGHT = 20;
const PAD_X = 12;
const PAD_Y = 8;
const MARGIN = 16;
// A cell's text past this width ends in an ellipsis.
const MAX_TEXT_WIDTH = 320;
const MIN_COLUMN = 40;
// Lines shown of a cell with line breaks.
const MAX_LINES = 6;
const NOTE_HEIGHT = LINE_HEIGHT + PAD_Y;
// Measured text is cut to this many characters first: no column shows more.
const MEASURE_CHARS = 200;

const FONT_FAMILY =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif';
const COLOURS = {
  background: "#ffffff",
  header: "#e2e8f0",
  stripe: "#f8fafc",
  grid: "#cbd5e1",
  text: "#0f172a",
  note: "#475569",
};

export type MeasureText = (text: string, bold: boolean) => number;

export type TableImageLayout = {
  // CSS pixels; the canvas is IMAGE_SCALE times larger.
  width: number;
  height: number;
  columns: { index: number; x: number; width: number }[];
  // Row -1 is the header.
  rows: { index: number; y: number; height: number; lines: string[][] }[];
  note: string | null;
};

const RTL_LETTER = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/;

function isRightToLeft(text: string): boolean {
  const letter = /\p{L}/u.exec(text);
  return Boolean(letter && RTL_LETTER.test(letter[0]));
}

// A cell's lines, at most MAX_LINES; the last shown ends in an ellipsis when
// there are more.
function cellLines(value: string): string[] {
  const lines = value.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  if (lines.length <= MAX_LINES) return lines;
  const shown = lines.slice(0, MAX_LINES);
  shown[MAX_LINES - 1] = `${shown[MAX_LINES - 1]}…`;
  return shown;
}

// The longest start of `text` that fits `width` with an ellipsis, or all of
// it when it fits.
export function fitText(text: string, width: number, measure: MeasureText, bold: boolean): string {
  // A line this long never fits; don't measure all of it.
  if (text.length <= MEASURE_CHARS && measure(text, bold) <= width) return text;
  const chars = Array.from(text.slice(0, MEASURE_CHARS));
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measure(`${chars.slice(0, middle).join("")}…`, bold) <= width) low = middle;
    else high = middle - 1;
  }
  return `${chars.slice(0, low).join("").trimEnd()}…`;
}

function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

// Which rows and columns fit, where each goes, and the note when some
// don't. Rows are kept while they fit the height; then columns while they
// fit the width, each as wide as its widest shown line (up to
// MAX_TEXT_WIDTH).
export function layoutTableImage(table: TableData, measure: MeasureText): TableImageLayout {
  const header = table.headers.map(cellLines);
  const rowHeight = (lines: string[][]) =>
    lines.reduce((most, cell) => Math.max(most, cell.length), 1) * LINE_HEIGHT + 2 * PAD_Y;
  const headerHeight = rowHeight(header);

  const fitRows = (limit: number) => {
    const rows: { index: number; lines: string[][]; height: number }[] = [];
    let used = headerHeight;
    for (let index = 0; index < table.rows.length; index += 1) {
      const lines = (table.rows[index] ?? []).map(cellLines);
      const height = rowHeight(lines);
      if (used + height > limit) break;
      rows.push({ index, lines, height });
      used += height;
    }
    return rows;
  };
  const fitColumns = (rows: { lines: string[][] }[]) => {
    const columns: { index: number; x: number; width: number }[] = [];
    let x = MARGIN;
    for (let index = 0; index < table.headers.length; index += 1) {
      let widest = 0;
      for (const line of header[index] ?? []) widest = Math.max(widest, measure(line.slice(0, MEASURE_CHARS), true));
      for (const row of rows) {
        for (const line of row.lines[index] ?? []) widest = Math.max(widest, measure(line.slice(0, MEASURE_CHARS), false));
      }
      const width = Math.max(MIN_COLUMN, Math.ceil(Math.min(widest, MAX_TEXT_WIDTH)) + 2 * PAD_X);
      // The first column always shows; it can't be wider than the canvas.
      if (columns.length && x + width > MAX_CSS - MARGIN) break;
      columns.push({ index, x, width });
      x += width;
    }
    return columns;
  };

  const space = MAX_CSS - 2 * MARGIN;
  let rows = fitRows(space);
  let columns = fitColumns(rows);
  const cut = () => rows.length < table.rows.length || columns.length < table.headers.length;
  if (cut()) {
    // Room for the note under the table.
    rows = fitRows(space - NOTE_HEIGHT);
    columns = fitColumns(rows);
  }

  let note: string | null = null;
  if (cut()) {
    const parts = [];
    if (rows.length < table.rows.length) parts.push(`${formatCount(rows.length)} of ${formatCount(table.rows.length)} rows`);
    if (columns.length < table.headers.length) {
      parts.push(`${formatCount(columns.length)} of ${formatCount(table.headers.length)} columns`);
    }
    note = `Showing the first ${parts.join(" and ")}.`;
  }

  const placed: TableImageLayout["rows"] = [{ index: -1, y: MARGIN, height: headerHeight, lines: header }];
  let y = MARGIN + headerHeight;
  for (const row of rows) {
    placed.push({ index: row.index, y, height: row.height, lines: row.lines });
    y += row.height;
  }
  const last = columns[columns.length - 1];
  const tableWidth = last ? last.x + last.width - MARGIN : 0;
  const noteWidth = note ? Math.min(space, Math.ceil(measure(note, false))) : 0;
  return {
    width: Math.max(tableWidth, noteWidth) + 2 * MARGIN,
    height: y + (note ? NOTE_HEIGHT : 0) + MARGIN,
    columns,
    rows: placed,
    note,
  };
}

type Context2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function font(bold: boolean, size = FONT_SIZE) {
  return `${bold ? "600" : "400"} ${size}px ${FONT_FAMILY}`;
}

function drawTable(context: Context2D, layout: TableImageLayout, measure: MeasureText) {
  context.fillStyle = COLOURS.background;
  context.fillRect(0, 0, layout.width, layout.height);
  const left = MARGIN;
  const last = layout.columns[layout.columns.length - 1];
  const right = last ? last.x + last.width : left;
  const bottom = layout.rows.reduce((end, row) => Math.max(end, row.y + row.height), MARGIN);

  layout.rows.forEach((row, position) => {
    if (row.index === -1) context.fillStyle = COLOURS.header;
    else if (position % 2 === 0) context.fillStyle = COLOURS.stripe;
    else return;
    context.fillRect(left, row.y, right - left, row.height);
  });

  context.strokeStyle = COLOURS.grid;
  context.lineWidth = 1;
  context.beginPath();
  // Half-pixel offsets keep 1 px lines crisp at twice the size.
  for (const row of layout.rows) {
    context.moveTo(left, row.y + 0.25);
    context.lineTo(right, row.y + 0.25);
  }
  context.moveTo(left, bottom - 0.25);
  context.lineTo(right, bottom - 0.25);
  for (const column of layout.columns) {
    context.moveTo(column.x + 0.25, MARGIN);
    context.lineTo(column.x + 0.25, bottom);
  }
  context.moveTo(right - 0.25, MARGIN);
  context.lineTo(right - 0.25, bottom);
  context.stroke();

  context.fillStyle = COLOURS.text;
  context.textBaseline = "middle";
  for (const row of layout.rows) {
    const bold = row.index === -1;
    context.font = font(bold);
    for (const column of layout.columns) {
      const lines = row.lines[column.index] ?? [];
      const rtl = isRightToLeft(lines.join(" "));
      context.direction = rtl ? "rtl" : "ltr";
      context.textAlign = rtl ? "right" : "left";
      const x = rtl ? column.x + column.width - PAD_X : column.x + PAD_X;
      lines.forEach((line, index) => {
        const text = fitText(line, column.width - 2 * PAD_X, measure, bold);
        context.fillText(text, x, row.y + PAD_Y + (index + 0.5) * LINE_HEIGHT);
      });
    }
  }

  if (layout.note) {
    context.font = font(false, 13);
    context.direction = "ltr";
    context.textAlign = "left";
    context.fillStyle = COLOURS.note;
    context.fillText(layout.note, left, bottom + NOTE_HEIGHT / 2 + 2);
  }
}

function makeCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    // Safari before 16.4 has OffscreenCanvas without a 2D context.
    if (canvas.getContext("2d")) return canvas;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: OffscreenCanvas | HTMLCanvasElement): Context2D {
  const context = canvas.getContext("2d") as Context2D | null;
  if (!context) throw new Error("This browser can't draw the table image.");
  return context;
}

async function encode(canvas: OffscreenCanvas | HTMLCanvasElement, type: string): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality: 0.92 });
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The table image couldn't be encoded."))), type, 0.92),
  );
}

export async function writeTableImage(
  table: TableData,
  format: "png" | "jpeg",
): Promise<{ buffer: ArrayBuffer; notice?: string; image: { width: number; height: number } }> {
  const measuring = context2d(makeCanvas(1, 1));
  const widths = new Map<string, number>();
  const measure: MeasureText = (text, bold) => {
    const key = `${bold ? 1 : 0}${text}`;
    let width = widths.get(key);
    if (width === undefined) {
      measuring.font = font(bold);
      width = measuring.measureText(text).width;
      widths.set(key, width);
    }
    return width;
  };
  const layout = layoutTableImage(table, measure);
  const image = { width: Math.ceil(layout.width * IMAGE_SCALE), height: Math.ceil(layout.height * IMAGE_SCALE) };
  const canvas = makeCanvas(image.width, image.height);
  const context = context2d(canvas);
  context.scale(IMAGE_SCALE, IMAGE_SCALE);
  drawTable(context, layout, measure);
  const blob = await encode(canvas, format === "png" ? "image/png" : "image/jpeg");
  return {
    buffer: await blob.arrayBuffer(),
    image,
    notice: layout.note ? `${layout.note} The image holds what fits in ${IMAGE_MAX_SIDE} pixels; save as PDF or Excel for the whole table.` : undefined,
  };
}
