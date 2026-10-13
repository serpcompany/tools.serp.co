import test from "node:test";
import assert from "node:assert/strict";

import { excelPageCells, writeExcelCells } from "../../lib/convert/excel-cells.ts";
import { parseExcelCells } from "../../lib/convert/table-data.ts";
import { copiedShape, excelPaste } from "./excel-paste.ts";

// Clipboard HTML as Excel writes it for copied cells: styles, conditional
// comments, columns, a formula attribute holding ">", a line break in a cell,
// merged cells and the columns it adds for browsers that misalign them.
const excelHtml = (rows) => `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta name=ProgId content=Excel.Sheet><style><!--table {mso-displayed-decimal-separator:"\\.";} td {padding-top:1px;}--></style></head>
<body link="#0563C1"><!--[if gte mso 9]><xml><x:ExcelWorkbook><table></table></x:ExcelWorkbook></xml><![endif]-->
<table border=0 cellpadding=0 cellspacing=0 width=128 style='border-collapse:collapse;width:96pt'>
<!--StartFragment-->
 <col width=64 span=2 style='width:48pt'>
${rows}
<![if supportMisalignedColumns]>
 <tr height=0 style='display:none'><td width=64 style='width:48pt'></td><td width=64 style='width:48pt'></td></tr>
<![endif]>
<!--EndFragment-->
</table></body></html>`;

test("Excel's clipboard HTML gives the copied cells' shape: rows, cells, merged cells, line breaks, and the text of cells that start with a quote", () => {
  const html = excelHtml(`
 <tr height=20 style='height:15.0pt'>
  <td height=20 class=xl65 style='height:15.0pt;width:48pt'>Item</td>
  <td class=xl65 style='width:48pt' x:fmla="=IF(A1>0,&quot;a&quot;,&quot;b&quot;)">Note</td>
 </tr>
 <tr height=40 style='height:30.0pt'>
  <td height=40 class=xl66 width=64 style='height:30.0pt;width:48pt'>Shirt</td>
  <td class=xl66 width=64 style='width:48pt'>line1<br style='mso-data-placement:same-cell' />line2</td>
 </tr>
 <tr><td>Pants</td><td class=xl67>&quot;</td></tr>
 <tr><td colspan=2 rowspan=2>Merged</td></tr>
 <tr></tr>
 <tr><td rowspan=2>Tall</td><td>"x""y"</td></tr>
 <tr><td>  <font>&#34;</font></td></tr>`);
  const shape = copiedShape(html);
  assert.deepEqual(shape.widths, [2, 2, 2, 2, 2, 2, 2]);
  assert.deepEqual([...shape.quoted], ["1:1"]);
  assert.deepEqual([...shape.quoteFirst], [["2:1", '"'], ["5:1", '"x""y"'], ["6:1", '"']]);
});

test("other spreadsheets' clipboard HTML, and HTML that isn't a table", () => {
  // Google Sheets: a <br> in a cell, a tab in another.
  const sheets =
    '<google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}br {mso-data-placement:same-cell;}--></style>' +
    '<table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1"><colgroup><col width="100"/><col width="100"/></colgroup>' +
    '<tbody><tr style="height:21px;"><td style="overflow:hidden;">a</td><td>b<br>c</td></tr><tr><td>x\ty</td><td></td></tr></tbody></table>';
  assert.deepEqual(copiedShape(sheets), { widths: [2, 2], quoted: new Set(["0:1", "1:0"]), quoteFirst: new Map() });
  assert.equal(copiedShape("<p>Just text</p>"), null);
  assert.equal(copiedShape(""), null);
  assert.equal(copiedShape("<table><tr><td><table><tr><td>x</td></tr></table></td></tr></table>"), null);
  assert.equal(copiedShape("<table></table>"), null);
});

const html = (rows) =>
  excelHtml(
    rows
      .map((cells) => `<tr>${cells.map((value) => `<td>${value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("\n", "<br style='mso-data-placement:same-cell'>")}</td>`).join("")}</tr>`)
      .join("\n"),
  );
const copy = (value) => (/[\t\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
const excelText = (rows) => `${rows.map((cells) => cells.map(copy).join("\t")).join("\r\n")}\r\n`;
const paste = (rows, input = {}) => ({ plain: excelText(rows), html: html(rows), value: "", start: 0, end: 0, ...input });
// The table the input's text reads as, with the cells the page wrote there.
const reads = (result) => parseExcelCells(result.value, excelPageCells(result.wrote)).table;
const asTable = ([headers, ...rows]) => ({ headers, rows });

test("a paste the visitor's reading gets right is the browser's own; the review's ditto marks are such a paste", () => {
  const dittos = [["Item", "Color"], ["Shirt", "Red"], ["Pants", '"'], ["Hat", '"'], ["Sock", "Blue"]];
  assert.equal(excelPaste(paste(dittos)), null);
  assert.deepEqual(parseExcelCells(excelText(dittos).replaceAll("\r\n", "\n")).table, asTable(dittos));
  // Over all of the input, too.
  assert.equal(excelPaste(paste(dittos, { value: "old", start: 0, end: 3 })), null);
  // Without HTML, or HTML of another table, the browser pastes.
  assert.equal(excelPaste({ ...paste(dittos), html: "" }), null);
  assert.equal(excelPaste({ ...paste(dittos), html: html([["a"]]) }), null);
});

test("a paste the clipboard's HTML says reads differently goes in as the page's text, which reads as copied", () => {
  // One column of cells holding line breaks: the visitor's reading keeps
  // every line a row, so the page takes the text as written by it.
  const addresses = [["Address"], ["1 Main St\nSpringfield"], ["2 Oak Ave\nShelbyville"]];
  const result = excelPaste(paste(addresses));
  const text = 'Address\n"1 Main St\nSpringfield"\n"2 Oak Ave\nShelbyville"\n';
  assert.deepEqual(result, { value: text, caret: text.length, wrote: text, replacesInput: true });
  assert.deepEqual(reads(result), asTable(addresses));
  // Without them, the visitor's reading keeps every line a row.
  assert.equal(parseExcelCells(result.value).table.rows.length, 4);
  // Ditto marks in that column too: neither reading of the text as it is
  // gives the copied table, so the page writes it its own way.
  const both = [["Address"], ['"'], ['"'], ["1 Main St\nSpringfield"]];
  const written = excelPaste(paste(both));
  assert.deepEqual(written, { value: writeExcelCells(asTable(both)), caret: written.value.length, wrote: written.value, replacesInput: true });
  assert.equal(written.value, 'Address\n""""\n""""\n"1 Main St\nSpringfield"');
  assert.deepEqual(reads(written), asTable(both));
  // A real multi-line cell between ditto marks in two columns: the visitor's
  // reading already gets it right.
  const mixed = [["Item", "Note"], ["Shirt", "line1\nline2"], ["Pants", '"'], ["Hat", '"']];
  assert.equal(excelPaste(paste(mixed)), null);
  assert.deepEqual(parseExcelCells(excelText(mixed).replaceAll("\r\n", "\n")).table, asTable(mixed));
});

test("Excel's HTML says `\"\"\"\"` and `\"\"\"Doc\"\"\"` are cells' text as it stands: the page writes them so they read back (#299 review)", () => {
  const rows = [["Code", "Note"], ['""""', "empty string"], ['"""Doc"""', "docstring"]];
  // The visitor's reading takes them as quoted for their quotes.
  assert.deepEqual(parseExcelCells(excelText(rows)).table.rows, [['"', "empty string"], ['"Doc"', "docstring"]]);
  const result = excelPaste(paste(rows));
  assert.equal(result.value, 'Code\tNote\n""""""""""\tempty string\n"""""""Doc"""""""\tdocstring');
  assert.deepEqual(reads(result), asTable(rows));
});

test("cells pasted into part of the input with the HTML are written the page's way when the visitor's reading differs; one cell of one line, or no HTML, is pasted as it is", () => {
  // One column: a cell holding line breaks and a ditto mark read as copied
  // only as the page's cells.
  const value = "Address\n9 Pine Rd\n";
  const rows = [["1 Main St\nSpringfield"], ['"']];
  const insert = '"1 Main St\nSpringfield"\n""""\n';
  const result = excelPaste(paste(rows, { value, start: value.length, end: value.length }));
  assert.deepEqual(result, { value: `${value}${insert}`, caret: value.length + insert.length, wrote: insert, replacesInput: false });
  assert.deepEqual(reads(result).rows, [["9 Pine Rd"], ...rows]);
  // In the middle of the text, as rows above the next.
  assert.equal(excelPaste(paste(rows, { value, start: 8, end: 8 })).value, `Address\n${insert}9 Pine Rd\n`);
  // Ditto marks the visitor's reading gets right: the browser pastes.
  const colors = "Item\tColor\nShirt\tRed\n";
  assert.equal(excelPaste(paste([["Pants", '"'], ["Hat", '"']], { value: colors, start: colors.length, end: colors.length })), null);
  // One cell of one line, whatever its quotes, or no HTML: the browser pastes.
  assert.equal(excelPaste(paste([['""""']], { value, start: 3, end: 3 })), null);
  assert.equal(excelPaste({ ...paste(rows, { value, start: 8, end: 8 }), html: "" }), null);
});
