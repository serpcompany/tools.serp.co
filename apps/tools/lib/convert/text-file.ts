// Reading a plain-text file (#265): its encoding, its line breaks and the
// characters a text editor doesn't show. Shared by TXT to an image
// (text-image.ts) and TXT and XML to PDF (text-pdf.ts, #283).

// The text a file holds: UTF-8 or UTF-16 when a byte order mark says so,
// else UTF-8, else (when it isn't valid UTF-8) Windows-1252, as a browser
// shows a plain-text file with no charset.
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

// Line breaks: CR LF, CR, LF, and the other breaks Unicode names (form
// feed, vertical tab, NEL, line and paragraph separators).
export const LINE_BREAK = /\r\n|[\r\n\f\v\u0085\u2028\u2029]/g;
const ENDS_WITH_BREAK = /[\r\n\f\v\u0085\u2028\u2029]$/;
// Terminal colour codes and other escape sequences, then the control
// characters a text editor doesn't show.
// eslint-disable-next-line no-control-regex
const ESCAPE_SEQUENCE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g;
// eslint-disable-next-line no-control-regex
export const CONTROL = /[\x00-\x08\x0e-\x1f\x7f]/g;
// Tabs stop every this many characters.
const TAB_SIZE = 4;

// A source line as drawn: escape sequences and control characters dropped,
// tabs as spaces to the next tab stop.
export function cleanLine(line: string): string {
  const text = line.replace(ESCAPE_SEQUENCE, "").replace(CONTROL, "");
  if (!text.includes("\t")) return text;
  let out = "";
  let column = 0;
  for (const char of text) {
    if (char === "\t") {
      const spaces = TAB_SIZE - (column % TAB_SIZE);
      out += " ".repeat(spaces);
      column += spaces;
    } else {
      out += char;
      column += 1;
    }
  }
  return out;
}

// How many lines the text has: one more than its line breaks, not counting
// a break at the very end.
export function countLines(text: string): number {
  let count = 1;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0x0d) {
      if (text.charCodeAt(index + 1) === 0x0a) index += 1;
      count += 1;
    } else if (code === 0x0a || code === 0x0b || code === 0x0c || code === 0x85 || code === 0x2028 || code === 0x2029) {
      count += 1;
    }
  }
  return ENDS_WITH_BREAK.test(text) ? count - 1 : count;
}

// The text's lines, as countLines counts them, each with the break that
// ends it ("" for the last line). Read one at a time, so a file of millions
// of lines is never split into an array.
export function* textLines(text: string): Generator<{ line: string; end: string }> {
  const pattern = new RegExp(LINE_BREAK.source, "g");
  let start = 0;
  for (;;) {
    pattern.lastIndex = start;
    const match = pattern.exec(text);
    if (!match) {
      if (start < text.length || start === 0) yield { line: text.slice(start), end: "" };
      return;
    }
    yield { line: text.slice(start, match.index), end: match[0] };
    start = match.index + match[0].length;
  }
}
