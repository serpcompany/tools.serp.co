import test from "node:test";
import assert from "node:assert/strict";

import {
  BUILT_IN_FORMATS,
  dateParts,
  formatCellNumber,
  formatGeneral,
  isDateFormat,
  splitSections,
} from "./excel-number-format.ts";

test("General shows integers whole and other numbers to 10 significant digits", () => {
  assert.equal(formatGeneral(0), "0");
  assert.equal(formatGeneral(42), "42");
  assert.equal(formatGeneral(-7), "-7");
  assert.equal(formatGeneral(1 / 3), "0.3333333333");
  assert.equal(formatGeneral(0.1 + 0.2), "0.3");
  assert.equal(formatGeneral(12345678901), "12345678901");
  assert.equal(formatGeneral(123456789012), "1.23457E+11");
  assert.equal(formatGeneral(0.0000000001234), "1.234E-10");
  assert.equal(formatCellNumber(3.5, "General"), "3.5");
  assert.equal(formatCellNumber(3.5, ""), "3.5");
});

test("decimals, thousands separators and percentages", () => {
  const cases = [
    [1234.5, BUILT_IN_FORMATS[1], "1235"],
    [1234.5, BUILT_IN_FORMATS[2], "1234.50"],
    [1234567.891, BUILT_IN_FORMATS[3], "1,234,568"],
    [1234567.891, BUILT_IN_FORMATS[4], "1,234,567.89"],
    [0.1234, BUILT_IN_FORMATS[9], "12%"],
    [0.1234, BUILT_IN_FORMATS[10], "12.34%"],
    [1.005, "0.00", "1.01"],
    [0.5, "#.00", ".50"],
    [1.5, "0.0#", "1.5"],
    [1.25, "0.0#", "1.25"],
    [7, "000", "007"],
    [1234567, "#,##0,", "1,235"],
    [1234567, '0.0,,"M"', "1.2M"],
    [-1234.5, "#,##0.00", "-1,234.50"],
    [-0.001, "0.00", "0.00"],
    [0, "0.00", "0.00"],
  ];
  for (const [value, code, expected] of cases) assert.equal(formatCellNumber(value, code), expected, `${value} in ${code}`);
});

test("currency, literal text and sections for negatives and zero", () => {
  assert.equal(formatCellNumber(1234.5, BUILT_IN_FORMATS[7]), "$1,234.50 ");
  assert.equal(formatCellNumber(-1234.5, BUILT_IN_FORMATS[7]), "($1,234.50)");
  assert.equal(formatCellNumber(1234.5, '[$€-407]#,##0.00'), "€1,234.50");
  assert.equal(formatCellNumber(-5, "[Red]0;[Blue]-0"), "-5");
  assert.equal(formatCellNumber(0, '0;-0;"zero"'), "zero");
  assert.equal(formatCellNumber(12, '0" units"'), "12 units");
  assert.equal(formatCellNumber(12, "0\\ \\k\\g"), "12 kg");
  assert.equal(formatCellNumber(-12, "#,##0_);(#,##0)"), "(12)");
  assert.equal(formatCellNumber(150, "[>100]0\" big\";0\" small\""), "150 big");
  assert.equal(formatCellNumber(50, "[>100]0\" big\";0\" small\""), "50 small");
  assert.equal(formatCellNumber(5, "@"), "5");
});

test("scientific notation", () => {
  assert.equal(formatCellNumber(12345.678, BUILT_IN_FORMATS[11]), "1.23E+04");
  assert.equal(formatCellNumber(0.000123, "0.00E+00"), "1.23E-04");
  assert.equal(formatCellNumber(9.999, "0.0E+0"), "1.0E+1");
  assert.equal(formatCellNumber(12345, BUILT_IN_FORMATS[48]), "12.3E+3");
  assert.equal(formatCellNumber(0, "0.00E+00"), "0.00E+00");
});

test("a serial date is its day, with Excel's 1900 leap day and the 1904 system", () => {
  assert.deepEqual(
    (({ year, month, day }) => [year, month, day])(dateParts(46095)),
    [2026, 3, 14],
  );
  assert.deepEqual((({ year, month, day }) => [year, month, day])(dateParts(60)), [1900, 2, 29]);
  assert.deepEqual((({ year, month, day }) => [year, month, day])(dateParts(59)), [1900, 2, 28]);
  assert.deepEqual((({ year, month, day }) => [year, month, day])(dateParts(61)), [1900, 3, 1]);
  assert.deepEqual((({ year, month, day }) => [year, month, day])(dateParts(1)), [1900, 1, 1]);
  assert.deepEqual((({ year, month, day }) => [year, month, day])(dateParts(0, true)), [1904, 1, 1]);
  assert.equal(dateParts(-1), null);
  assert.equal(dateParts(3_000_000), null);
});

test("dates and times as Excel shows them", () => {
  const serial = 46095.5625; // 2026-03-14 13:30
  assert.equal(formatCellNumber(serial, BUILT_IN_FORMATS[14]), "3/14/2026");
  assert.equal(formatCellNumber(serial, BUILT_IN_FORMATS[15]), "14-Mar-26");
  assert.equal(formatCellNumber(serial, BUILT_IN_FORMATS[17]), "Mar-26");
  assert.equal(formatCellNumber(serial, BUILT_IN_FORMATS[18]), "1:30 PM");
  assert.equal(formatCellNumber(serial, BUILT_IN_FORMATS[20]), "13:30");
  assert.equal(formatCellNumber(serial, BUILT_IN_FORMATS[22]), "3/14/2026 13:30");
  assert.equal(formatCellNumber(serial, "yyyy-mm-dd hh:mm:ss"), "2026-03-14 13:30:00");
  assert.equal(formatCellNumber(serial, "dddd, mmmm d, yyyy"), "Saturday, March 14, 2026");
  assert.equal(formatCellNumber(serial, "ddd d mmm"), "Sat 14 Mar");
  assert.equal(formatCellNumber(serial, "mmmmm"), "M");
  assert.equal(formatCellNumber(serial, "[$-409]h:mm AM/PM;@"), "1:30 PM");
  assert.equal(formatCellNumber(0.25, "h:mm a/p"), "6:00 a");
  assert.equal(formatCellNumber(1.5, BUILT_IN_FORMATS[46]), "36:00:00");
  assert.equal(formatCellNumber(0.0000578704, "mm:ss.0"), "00:05.0");
  // 23:59:59.6 rounds up to the next day.
  assert.equal(formatCellNumber(46095 + 86399.6 / 86400, "m/d/yyyy hh:mm:ss"), "3/15/2026 00:00:00");
  assert.equal(formatCellNumber(46095, "yyyy-mm-dd", true), "2030-03-15");
});

test("date formats are told from number formats", () => {
  for (const id of [14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]) assert.ok(isDateFormat(BUILT_IN_FORMATS[id]), `${id}`);
  for (const id of [0, 1, 2, 3, 4, 5, 9, 10, 11, 37, 48, 49]) assert.ok(!isDateFormat(BUILT_IN_FORMATS[id]), `${id}`);
  assert.ok(!isDateFormat('0" days"'));
  assert.ok(!isDateFormat("[Red]0.00"));
  assert.ok(isDateFormat("[$-F800]dddd\\,\\ mmmm\\ dd\\,\\ yyyy"));
});

test("sections split at semicolons outside quotes and escapes", () => {
  assert.deepEqual(splitSections('0;"a;b";\\;0'), ["0", '"a;b"', "\\;0"]);
});
