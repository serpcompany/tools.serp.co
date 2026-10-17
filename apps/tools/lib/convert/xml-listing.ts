// An XML file as an indented listing (#283): its elements with their
// attributes, its text, CDATA, comments, processing instructions and
// DOCTYPE, a line each, two spaces in for each level. text-pdf.ts sets the
// lines on PDF pages.
//
// The file is read with sax, strictly: a file that isn't well-formed is
// refused with the parser's own message and where it stopped. Nothing in it
// loads or expands: an entity reference other than XML's five (&amp; &lt;
// &gt; &quot; &apos;) and character references is shown as written, so a
// DOCTYPE's entities, external or recursive (a "billion laughs" file), cost
// no more than their own text.

import sax from "sax";

import { TextPdfError } from "./text-pdf-targets.ts";
import { cleanLine, decodeText, textLines } from "./text-file.ts";

// One line of the listing: `indent` columns in, and `hang` more columns in
// for the lines it wraps onto. Comments, processing instructions and the
// DOCTYPE are `muted`.
export type ListingLine = { text: string; indent: number; hang?: number; muted?: boolean };

// Two columns a level, up to this many levels: deeper elements are listed at
// the deepest indent, so a line always has room for its text.
export const INDENT = 2;
export const MAX_INDENT_LEVELS = 20;
const indentOf = (depth: number) => Math.min(depth, MAX_INDENT_LEVELS) * INDENT;
// A start tag's attributes, wrapped, line up past the tag's indent.
const TAG_HANG = 4;

const PREDEFINED: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

// ------------------------------------------------------------- reading --

const MALFORMED_PREFIX = "This file isn't well-formed XML, so it can't be listed.";

function malformed(reason: string, line: number, column: number, cause?: unknown): TextPdfError {
  return new TextPdfError(
    "malformed_xml",
    `${MALFORMED_PREFIX} The parser stopped at line ${line}, column ${column}: ${reason}`,
    cause,
  );
}

// The encoding an XML declaration names, read from the file's first bytes
// as ASCII.
function declaredEncoding(bytes: Uint8Array): string | null {
  const head = new TextDecoder("windows-1252").decode(bytes.subarray(0, 512));
  return /^<\?xml\s[^>]*?\bencoding\s*=\s*(["'])([A-Za-z][A-Za-z0-9._-]*)\1/.exec(head)?.[2] ?? null;
}

// An XML file's text: UTF-8 or UTF-16 by its byte order mark, UTF-16 when
// its "<?" is two bytes a character, else the encoding its declaration names,
// else as a plain-text file is read (text-file.ts). An encoding the browser
// can't decode, or bytes that aren't in it, are refused.
export function decodeXml(bytes: Uint8Array): string {
  const bom = (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) || (bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0xff && bytes[1] === 0xfe);
  if (bom) return decodeText(bytes);
  if (bytes[0] === 0x3c && bytes[1] === 0 && bytes[2] === 0x3f && bytes[3] === 0) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0 && bytes[1] === 0x3c && bytes[2] === 0 && bytes[3] === 0x3f) return new TextDecoder("utf-16be").decode(bytes);
  const label = declaredEncoding(bytes);
  if (!label) return decodeText(bytes);
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(label, { fatal: true });
  } catch {
    throw new TextPdfError(
      "unsupported_encoding",
      `This XML file says it's in ${label}, which can't be read here. Save it as UTF-8 and convert it again.`,
    );
  }
  // A declaration readable as ASCII isn't in UTF-16, whatever it says.
  if (decoder.encoding === "utf-8" || decoder.encoding.startsWith("utf-16")) return decodeText(bytes);
  try {
    return decoder.decode(bytes);
  } catch (error) {
    throw new TextPdfError(
      "unsupported_encoding",
      `This XML file says it's in ${label}, but it holds bytes that aren't. Save it as UTF-8 and convert it again.`,
      error,
    );
  }
}

// ------------------------------------------------------------- listing --

// Text as listed: each line cleaned (text-file.ts) and trimmed, without the
// blank lines that start or end it, and at most one blank line in a row.
// Read a line at a time, so a text of millions of lines is never an array.
function* textBlock(text: string): Generator<string> {
  let started = false;
  let blank = false;
  for (const { line } of textLines(text)) {
    const cleaned = cleanLine(line).trim();
    if (!cleaned) {
      blank = started;
      continue;
    }
    if (blank) yield "";
    blank = false;
    started = true;
    yield cleaned;
  }
}

// The first lines of `lines`, up to `count`, and the rest, still unread.
function take<T>(lines: Generator<T>, count: number): { first: T[]; rest: Generator<T> } {
  const first: T[] = [];
  while (first.length < count) {
    const next = lines.next();
    if (next.done) break;
    first.push(next.value);
  }
  return { first, rest: lines };
}

// An attribute as listed: its value in double quotes, or single quotes when
// it holds a double quote, with line breaks and tabs as spaces (as an XML
// parser normalises them).
function attribute(name: string, value: string): string {
  const flat = cleanLine(value.replace(/[\t\n\r]/g, " "));
  if (!flat.includes('"')) return `${name}="${flat}"`;
  if (!flat.includes("'")) return `${name}='${flat}'`;
  return `${name}="${flat.replace(/"/g, "&quot;")}"`;
}

// Lists `text`, an XML document, a line at a time to `emit`, which may throw
// to stop it (text-pdf.ts does, at the page limit). Throws a TextPdfError
// with code malformed_xml for a file that isn't well-formed, or no_text for
// an empty one.
export function listXml(text: string, emit: (line: ListingLine) => void): void {
  if (!text.trim()) throw new TextPdfError("no_text", "This XML file is empty: there's nothing to list in a PDF.");
  // sax refuses a text, comment, CDATA or DOCTYPE longer than its buffer
  // limit (64 KB); a well-formed file's are as long as the file. The parse
  // is synchronous, so the limit is back before any other code runs.
  // (@types/sax leaves the setting out.)
  const settings = sax as unknown as { MAX_BUFFER_LENGTH: number };
  const bufferLimit = settings.MAX_BUFFER_LENGTH;
  settings.MAX_BUFFER_LENGTH = Math.max(bufferLimit, text.length + 1);
  try {
    parse(text, emit);
  } finally {
    settings.MAX_BUFFER_LENGTH = bufferLimit;
  }
}

function parse(text: string, emit: (line: ListingLine) => void): void {
  const parser = sax.parser(true, { trim: false, normalize: false, position: true });
  // Entities: XML's five are read, character references as sax reads them,
  // and any other name is left as its reference, never looked up.
  parser.ENTITIES = new Proxy(Object.create(null) as Record<string, string>, {
    get: (_, name) => {
      if (typeof name !== "string" || name.startsWith("#")) return undefined;
      return Object.hasOwn(PREDEFINED, name) ? PREDEFINED[name] : `&${name};`;
    },
  });
  const fail = (reason: string, cause?: unknown) => malformed(reason, parser.line + 1, parser.column, cause);

  // Elements open, and whether the root element has been opened and closed.
  let depth = 0;
  let sawRoot = false;
  let rootClosed = false;
  // Text read since the last node that isn't text.
  let pendingText = "";
  // A start tag not listed yet: listed with its element's text on one line
  // when the element holds only that, or as "<name/>" when it holds nothing.
  let open: { start: string; selfClosing: boolean; depth: number } | null = null;
  let attributes: string[] = [];
  let cdata = "";

  const emitLines = (lines: Iterable<string>, at: number, style: { hang?: number; muted?: boolean } = {}) => {
    for (const line of lines) emit({ text: line, indent: indentOf(at), ...style });
  };
  const emitOpen = () => {
    if (open) emit({ text: `${open.start}>`, indent: indentOf(open.depth), hang: TAG_HANG });
    open = null;
  };
  // The text read so far, inside the element `inside` levels deep.
  const flushText = (inside = depth) => {
    const { first, rest } = take(textBlock(pendingText), 1);
    pendingText = "";
    if (!first.length) return;
    emitOpen();
    emitLines(first, inside);
    emitLines(rest, inside);
  };
  // Before a node that isn't text: the text and the start tag before it.
  const beforeNode = () => {
    flushText();
    emitOpen();
  };
  // A comment, processing instruction or DOCTYPE: its text on one line
  // between `start` and `end`, or when it has several lines, `start` on the
  // first and `end` on the last, the lines after the first indented.
  const emitMuted = (start: string, value: string, end: string) => {
    beforeNode();
    const { first, rest } = take(textBlock(value), 1);
    const lines = (function* () {
      let previous = `${start}${first[0] ? ` ${first[0]}` : ""}`;
      for (const line of rest) {
        yield previous;
        previous = line ? `  ${line}` : line;
      }
      yield `${previous}${end}`;
    })();
    emitLines(lines, depth, { hang: TAG_HANG, muted: true });
  };

  parser.onerror = (error) => {
    throw fail(error.message.split("\n")[0] || "unreadable", error);
  };
  parser.onattribute = ({ name, value }) => {
    attributes.push(attribute(name, value));
  };
  parser.onopentag = (node) => {
    if (depth === 0) {
      if (rootClosed) throw fail(`A second root element, <${node.name}>: an XML document has one.`);
      sawRoot = true;
    }
    beforeNode();
    open = { start: `<${[node.name, ...attributes].join(" ")}`, selfClosing: node.isSelfClosing, depth };
    attributes = [];
    depth += 1;
  };
  parser.onclosetag = (name) => {
    depth -= 1;
    const { first } = take(textBlock(pendingText), 2);
    if (open && first.length <= 1) {
      pendingText = "";
      const end = first.length ? `>${first[0]}</${name}>` : open.selfClosing ? "/>" : `></${name}>`;
      emit({ text: `${open.start}${end}`, indent: indentOf(open.depth), hang: TAG_HANG });
      open = null;
    } else {
      flushText(depth + 1);
      emit({ text: `</${name}>`, indent: indentOf(depth), hang: TAG_HANG });
    }
    if (depth === 0) rootClosed = true;
  };
  parser.ontext = (value) => {
    pendingText += value;
  };
  parser.onopencdata = () => {
    beforeNode();
    cdata = "";
  };
  parser.oncdata = (value) => {
    cdata += value;
  };
  // CDATA keeps its lines as they are, but for tabs and control characters.
  parser.onclosecdata = () => {
    const { first, rest } = take(
      (function* () {
        for (const { line } of textLines(cdata)) yield cleanLine(line).trimEnd();
      })(),
      2,
    );
    cdata = "";
    if (first.length === 1) {
      emitLines([`<![CDATA[${first[0]}]]>`], depth);
      return;
    }
    emitLines(["<![CDATA[", ...first], depth);
    emitLines(rest, depth);
    emitLines(["]]>"], depth);
  };
  parser.oncomment = (value) => emitMuted("<!--", value, " -->");
  parser.onprocessinginstruction = ({ name, body }) => emitMuted(`<?${name}`, body, "?>");
  parser.ondoctype = (value) => emitMuted("<!DOCTYPE", value, ">");

  parser.write(text).close();
  if (!sawRoot) throw new TextPdfError("malformed_xml", `${MALFORMED_PREFIX} It holds no XML elements.`);
}
