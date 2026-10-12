// A number in an XLSX cell as Excel shows it, from the cell's number format
// (issue #265): General, decimals, thousands separators, percentages,
// scientific notation, currency and other literal text, dates and times.
// A workbook stores numbers, not the text a cell shows, so a picture of a
// sheet needs this to show "12%" and "3/14/2026" rather than 0.12 and 46095.
// Fractions ("# ?/?") are shown as decimals, and conditions ("[>100]") pick
// a section as Excel does for the common forms only.

// Excel's built-in formats, by id; a workbook names only the formats it
// adds (ids 164 and up). Dates and currencies follow Excel's en-US locale.
export const BUILT_IN_FORMATS: Record<number, string> = {
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  5: '"$"#,##0_);("$"#,##0)',
  6: '"$"#,##0_);[Red]("$"#,##0)',
  7: '"$"#,##0.00_);("$"#,##0.00)',
  8: '"$"#,##0.00_);[Red]("$"#,##0.00)',
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  12: "# ?/?",
  13: "# ??/??",
  14: "m/d/yyyy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yyyy h:mm",
  37: "#,##0 ;(#,##0)",
  38: "#,##0 ;[Red](#,##0)",
  39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;[Red](#,##0.00)",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mm:ss.0",
  48: "##0.0E+0",
  49: "@",
};
// The East Asian locales' built-in dates (27 to 36, 50 to 58), which other
// locales show as a short date.
for (const id of [27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58]) BUILT_IN_FORMATS[id] = "m/d/yyyy";
BUILT_IN_FORMATS[32] = "h:mm:ss";
BUILT_IN_FORMATS[33] = "h:mm:ss";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// A format's sections, split at semicolons outside quotes, brackets and
// escapes.
export function splitSections(code: string): string[] {
  const sections: string[] = [];
  let current = "";
  for (let index = 0; index < code.length; index += 1) {
    const char = code[index]!;
    if (char === '"') {
      const end = code.indexOf('"', index + 1);
      const stop = end === -1 ? code.length : end + 1;
      current += code.slice(index, stop);
      index = stop - 1;
    } else if (char === "[") {
      const end = code.indexOf("]", index + 1);
      const stop = end === -1 ? code.length : end + 1;
      current += code.slice(index, stop);
      index = stop - 1;
    } else if (char === "\\" || char === "_" || char === "*") {
      current += code.slice(index, index + 2);
      index += 1;
    } else if (char === ";") {
      sections.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  sections.push(current);
  return sections;
}

type Token = { kind: "literal"; text: string } | { kind: "code"; text: string };

// A section as literal text and format codes: quoted text, escaped
// characters, `_x` (a space as wide as x) and `*x` (a fill, dropped) become
// literal text; [Red] and other colours, [$-409] locales and conditions go;
// [$€-407] becomes its symbol.
function tokenize(section: string): Token[] {
  const tokens: Token[] = [];
  const literal = (text: string) => {
    const last = tokens[tokens.length - 1];
    if (last?.kind === "literal") last.text += text;
    else tokens.push({ kind: "literal", text });
  };
  for (let index = 0; index < section.length; index += 1) {
    const char = section[index]!;
    if (char === '"') {
      const end = section.indexOf('"', index + 1);
      const stop = end === -1 ? section.length : end;
      literal(section.slice(index + 1, stop));
      index = stop;
    } else if (char === "\\") {
      literal(section[index + 1] ?? "");
      index += 1;
    } else if (char === "_") {
      literal(" ");
      index += 1;
    } else if (char === "*") {
      index += 1;
    } else if (char === "[") {
      const end = section.indexOf("]", index + 1);
      const stop = end === -1 ? section.length : end;
      const inner = section.slice(index + 1, stop);
      const currency = /^\$([^-]*)/.exec(inner);
      if (/^(h+|m+|s+)$/i.test(inner)) tokens.push({ kind: "code", text: `[${inner.toLowerCase()}]` });
      else if (currency) literal(currency[1] ?? "");
      index = stop;
    } else {
      tokens.push({ kind: "code", text: char });
    }
  }
  return tokens;
}

const DATE_CODES = /[ymdhs]|AM\/PM|A\/P|\[h+\]|\[m+\]|\[s+\]/i;

function codeText(tokens: Token[]): string {
  return tokens.filter((token) => token.kind === "code").map((token) => token.text).join("");
}

export function isDateFormat(code: string): boolean {
  const section = splitSections(code)[0] ?? "";
  if (/^general$/i.test(section.trim())) return false;
  const codes = codeText(tokenize(section));
  return DATE_CODES.test(codes.replace(/General/gi, "").replace(/E[+-]/g, ""));
}

// Excel's General: at most 11 characters, as in a cell of Excel's default
// width. Integers up to 11 digits are shown whole; numbers of 12 or more
// digits, and those under 0.0001, in scientific notation (1.23457E+11);
// others rounded to the decimals that fit.
export function formatGeneral(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (Number.isInteger(value) && abs < 1e11) return String(value);
  if (abs >= 1e11 || abs < 1e-4) {
    const [mantissa, exponent] = value.toExponential(5).split("e");
    const trimmed = mantissa!.replace(/\.?0+$/, "");
    const power = Number(exponent);
    return `${trimmed}E${power < 0 ? "-" : "+"}${String(Math.abs(power)).padStart(2, "0")}`;
  }
  const integerDigits = String(Math.floor(abs)).length;
  const decimals = Math.max(0, 11 - (value < 0 ? 1 : 0) - integerDigits - 1);
  const text = toFixedRounded(abs, decimals).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return value < 0 ? `-${text}` : text;
}

// `value` rounded half away from zero to `decimals` places, as a string
// with exactly that many.
function toFixedRounded(value: number, decimals: number): string {
  if (Math.abs(value) >= 1e21) return value.toFixed(decimals);
  const shifted = Math.round(Number(`${Math.abs(value)}e${decimals}`));
  const rounded = Number(`${shifted}e-${decimals}`);
  return rounded.toFixed(decimals);
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const isPlaceholder = (token: Token | undefined) => token?.kind === "code" && /^[0#?]$/.test(token.text);

function trimDecimals(digits: string, minDecimals: number): string {
  if (!digits.includes(".")) return digits;
  const [integer = "", fraction = ""] = digits.split(".");
  let kept = fraction;
  while (kept.length > minDecimals && kept.endsWith("0")) kept = kept.slice(0, -1);
  return `${integer}.${kept}`;
}

// A number section: the placeholders (0 # ?), the decimal point, thousands
// separators and an exponent replaced by the number; the literal text and
// codes around them (currency, %, parentheses, spaces) kept as they are.
// `value` is never negative: the caller adds the sign.
function formatNumberSection(value: number, tokens: Token[]): string {
  const first = tokens.findIndex(isPlaceholder);
  const literal = (token: Token) => token.text;
  if (first === -1) {
    // Only text: "General" or "@" in it show the number.
    return tokens.map(literal).join("").replace(/General|@/i, () => formatGeneral(value));
  }
  let last = first;
  tokens.forEach((token, index) => {
    if (isPlaceholder(token)) last = index;
  });
  // Commas (each divides by 1,000) and a point right after the last digit.
  while (tokens[last + 1]?.kind === "code" && /^[,.]$/.test(tokens[last + 1]!.text)) last += 1;
  const codes = tokens
    .slice(first, last + 1)
    .filter((token) => token.kind === "code")
    .map((token) => token.text)
    .join("");

  let scaled = value * 100 ** (tokens.filter((token) => token.kind === "code" && token.text === "%").length);
  const exponentAt = codes.search(/[Ee][+-]/);
  const mantissaCodes = exponentAt === -1 ? codes : codes.slice(0, exponentAt);
  const exponentCodes = exponentAt === -1 ? "" : codes.slice(exponentAt);
  const trailingCommas = /,*$/.exec(mantissaCodes)![0].length;
  scaled /= 1000 ** trailingCommas;
  const [integerCodes = "", decimalCodes] = mantissaCodes.slice(0, mantissaCodes.length - trailingCommas).split(".");
  const hasPoint = decimalCodes !== undefined;
  const decimals = (decimalCodes ?? "").replace(/[^0#?]/g, "").length;
  const minDecimals = (decimalCodes ?? "").replace(/[^0]/g, "").length;
  const integerDigits = integerCodes.replace(/[^0#?]/g, "").length;
  const minInteger = integerCodes.replace(/[^0]/g, "").length;

  let text: string;
  if (exponentCodes) {
    // "##0.0E+0" keeps the exponent a multiple of the integer digits.
    const step = integerDigits > 1 && integerCodes.includes("#") ? integerDigits : 1;
    let exponent = scaled === 0 ? 0 : Math.floor(Math.log10(scaled) / step) * step;
    let mantissa = toFixedRounded(scaled / 10 ** exponent, decimals);
    if (Number(mantissa) >= 10 ** step) {
      exponent += step;
      mantissa = toFixedRounded(scaled / 10 ** exponent, decimals);
    }
    const sign = exponent < 0 ? "-" : exponentCodes[1] === "+" ? "+" : "";
    const digits = Math.max(1, exponentCodes.replace(/[^0]/g, "").length);
    const shown = hasPoint ? trimDecimals(mantissa, minDecimals) : mantissa;
    text = `${shown}${exponentCodes[0]}${sign}${String(Math.abs(exponent)).padStart(digits, "0")}`;
  } else {
    const [whole = "0", fraction = ""] = toFixedRounded(scaled, decimals).split(".");
    let integer = whole === "0" && minInteger === 0 ? "" : whole.padStart(minInteger, "0");
    if (/[0#?],+[0#?]/.test(integerCodes)) integer = groupThousands(integer);
    text = hasPoint ? trimDecimals(`${integer}.${fraction}`, minDecimals) : integer;
  }
  const before = tokens.slice(0, first).map(literal).join("");
  const after = tokens.slice(last + 1).map(literal).join("");
  return `${before}${text}${after}`;
}

// ----------------------------------------------------------------- dates --

export type DateParts = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hours: number;
  minutes: number;
  seconds: number;
  // The fraction of a second.
  fraction: number;
};

// A serial date as its parts: days since 1899-12-30, with Excel's
// 1900-02-29 (which never was) as serial 60 and serial 0 as 1900-01-00, or
// since 1904-01-01. Null outside the dates Excel shows (before 0 or after
// 9999-12-31).
export function dateParts(serial: number, date1904 = false): DateParts | null {
  if (!Number.isFinite(serial) || serial < 0 || serial >= (date1904 ? 2957004 : 2958466)) return null;
  const days = Math.floor(serial);
  const time = (serial - days) * 86400;
  const seconds = Math.floor(time + 1e-6);
  let date: { year: number; month: number; day: number; weekday: number };
  if (!date1904 && days === 60) date = { year: 1900, month: 2, day: 29, weekday: 3 };
  else if (!date1904 && days === 0) date = { year: 1900, month: 1, day: 0, weekday: 6 };
  else {
    const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, days < 60 ? 31 : 30);
    const value = new Date(base + days * 86400000);
    date = { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate(), weekday: value.getUTCDay() };
  }
  return {
    ...date,
    hours: Math.floor(seconds / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
    fraction: Math.max(0, time - seconds),
  };
}

// A date section's codes as runs: yyyy, mmm, dd, hh, ss.00, AM/PM, [h] and
// the literal text between them.
function dateItems(tokens: Token[]): Array<{ code: string } | { literal: string }> {
  const items: Array<{ code: string } | { literal: string }> = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token.kind === "literal") {
      items.push({ literal: token.text });
      index += 1;
      continue;
    }
    if (token.text.startsWith("[")) {
      items.push({ code: token.text });
      index += 1;
      continue;
    }
    let run = "";
    while (index < tokens.length && tokens[index]!.kind === "code" && !tokens[index]!.text.startsWith("[")) {
      run += tokens[index]!.text;
      index += 1;
    }
    for (const match of run.matchAll(/AM\/PM|A\/P|[yY]+|[mM]+|[dD]+|[hH]+|[sS]+(?:\.0+)?|[eE]+|[\s\S]/gi)) {
      const code = match[0];
      items.push(/^(AM\/PM|A\/P|[ymdhse]+(\.0+)?)$/i.test(code) ? { code } : { literal: code });
    }
  }
  return items;
}

function formatDateSection(value: number, tokens: Token[], date1904: boolean): string {
  const items = dateItems(tokens);
  const codes = items.flatMap((item) => ("code" in item ? [item.code] : []));
  // The time is rounded to the smallest unit shown: hundredths of a second
  // for "ss.00", else seconds.
  const subSecond = Math.max(0, ...codes.map((code) => /\.(0+)$/.exec(code)?.[1]?.length ?? 0));
  const unit = 86400 * 10 ** subSecond;
  const serial = Math.round(value * unit) / unit;
  const parts = dateParts(serial, date1904);
  if (!parts) return formatGeneral(value);
  const twelveHour = codes.some((code) => /^(AM\/PM|A\/P)$/i.test(code));
  const pad = (number: number, size: number) => String(number).padStart(size, "0");
  // "m" is the minutes after an hour or before a second, else the month.
  const codeAt = (index: number) => {
    const item = items[index];
    return item && "code" in item ? item.code.toLowerCase() : null;
  };
  const isMinute = (index: number) => {
    for (let back = index - 1; back >= 0; back -= 1) {
      const code = codeAt(back);
      if (code === null) continue;
      if (/^\[?h+\]?$/.test(code)) return true;
      break;
    }
    for (let next = index + 1; next < items.length; next += 1) {
      const code = codeAt(next);
      if (code === null) continue;
      if (/^\[?s+/.test(code)) return true;
      break;
    }
    return false;
  };
  return items
    .map((item, index) => {
      if ("literal" in item) return item.literal;
      const code = item.code.toLowerCase();
      const size = code.length;
      if (code[0] === "y" || code[0] === "e") return size <= 2 && code[0] === "y" ? pad(parts.year % 100, 2) : String(parts.year);
      if (code[0] === "m" && isMinute(index)) return size >= 2 ? pad(parts.minutes, 2) : String(parts.minutes);
      if (code[0] === "m") {
        const name = MONTHS[parts.month - 1]!;
        if (size === 5) return name[0]!;
        if (size >= 4) return name;
        if (size === 3) return name.slice(0, 3);
        return size === 2 ? pad(parts.month, 2) : String(parts.month);
      }
      if (code[0] === "d") {
        const name = DAYS[parts.weekday]!;
        if (size >= 4) return name;
        if (size === 3) return name.slice(0, 3);
        return size === 2 ? pad(parts.day, 2) : String(parts.day);
      }
      if (code[0] === "h") {
        const hours = twelveHour ? parts.hours % 12 || 12 : parts.hours;
        return size >= 2 ? pad(hours, 2) : String(hours);
      }
      if (code[0] === "s") {
        const [whole = "", digits = ""] = code.split(".");
        const seconds = whole.length >= 2 ? pad(parts.seconds, 2) : String(parts.seconds);
        return digits ? `${seconds}.${parts.fraction.toFixed(digits.length).slice(2)}` : seconds;
      }
      if (code === "am/pm") return parts.hours < 12 ? "AM" : "PM";
      if (code === "a/p") {
        const letter = parts.hours < 12 ? "a" : "p";
        return item.code[0] === "a" ? letter : letter.toUpperCase();
      }
      // Elapsed time: [h], [mm], [ss].
      const elapsed = /^\[(h+|m+|s+)\]$/.exec(code)?.[1];
      if (elapsed) {
        const total = elapsed[0] === "h" ? Math.floor(serial * 24) : elapsed[0] === "m" ? Math.floor(serial * 1440) : Math.round(serial * 86400);
        return pad(total, elapsed.length);
      }
      return item.code;
    })
    .join("");
}

// The text a number cell shows in `code`'s format.
export function formatCellNumber(value: number, code: string, date1904 = false): string {
  const sections = splitSections(code || "General");
  // Sections with conditions ("[>=100]") apply where the condition holds.
  const conditional = sections.map((section) => /\[(<=|>=|<>|<|>|=)(-?[\d.]+)\]/.exec(section));
  let section: string;
  let shown = value;
  if (conditional.some(Boolean)) {
    const holds = (match: RegExpExecArray | null) => {
      if (!match) return false;
      const limit = Number(match[2]);
      switch (match[1]) {
        case "<": return value < limit;
        case "<=": return value <= limit;
        case ">": return value > limit;
        case ">=": return value >= limit;
        case "=": return value === limit;
        default: return value !== limit;
      }
    };
    const index = conditional.findIndex(holds);
    const fallback = conditional.findIndex((match, position) => !match && position < 3);
    section = sections[index !== -1 ? index : fallback !== -1 ? fallback : 0]!.replace(/\[(<=|>=|<>|<|>|=)-?[\d.]+\]/, "");
    if (index === -1 && value < 0) shown = Math.abs(value);
  } else if (value < 0 && sections.length >= 2 && sections[1]!.trim() !== "") {
    section = sections[1]!;
    shown = Math.abs(value);
  } else if (value === 0 && sections.length >= 3) {
    section = sections[2]!;
  } else {
    section = sections[0]!;
  }
  const tokens = tokenize(section);
  if (/^\s*General\s*$/i.test(section) || !tokens.length) return formatGeneral(value);
  if (isDateFormat(section)) {
    return formatDateSection(shown, tokens, date1904);
  }
  const text = formatNumberSection(Math.abs(shown), tokens);
  // One section: a negative number gets its minus sign in front.
  return shown < 0 && !/^-?0?\.?0*$/.test(text.replace(/[^\d.-]/g, "")) ? `-${text}` : text;
}
