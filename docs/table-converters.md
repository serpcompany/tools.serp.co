# Table converters

How the table converter pages (`TableConvertDemo`) write files, name what
they save, and read Excel input, all in the visitor's browser. Paths are under
`apps/tools/`. [execution-paths.md](execution-paths.md) covers the other
engines and the server routes.

## Tables into files (since #249)

The table converter pages (`TableConvertDemo`, with
`lib/convert/table-outputs.ts`) write Excel, PDF, PNG, JPEG, Avro and Protobuf
in the browser, once a visitor has given them a table, and load
each output's library only then: write-excel-file, jsPDF with
jspdf-autotable, avsc, protobufjs. Excel is one sheet with a bold, frozen
header row; a cell is a number only when it's a plain number Excel keeps
exactly (no leading zero, at most 15 digits), so zip codes, IDs and dates
stay text. A table past Excel's limits (1,048,576 rows, 16,384 columns,
32,767 characters a cell) is refused. A PDF is A4 with the header row on
each page, landscape when the columns need it, and columns that don't fit
continue on the next pages. Its text is in jsPDF's built-in Helvetica when
every character is in Windows-1252; otherwise the page loads DejaVu Sans
2.37 (`public/vendor/fonts/dejavu/`, 757 KB, about 380 KB gzipped, Bitstream
Vera licence), which covers Latin, Greek, Cyrillic, Hebrew and Arabic. Text it
has no glyph for (Chinese, Japanese, Korean, Indic and Thai scripts, emoji),
or that jsPDF can't set (Lao, N'Ko, the Arabic-script letters it has no joined
forms for), fails with a message pointing to PNG or Excel, rather than a
garbled file; right-to-left lines are drawn in display order and aligned
right, and Arabic letters joined as [text-pdf.md](text-pdf.md#fonts) says. PNG and
JPEG are drawn on a canvas at twice the size, in the system sans-serif font,
at most 4096 px a side: a larger table shows its first rows and columns, and
the image and the page say how many. Avro is an object container (null
codec) of a `Row` record of nullable strings, an empty cell null and each
field's `doc` its header; Protobuf is a `Table` of `Row` messages with a
string field per column, saved as a `.pb` beside the `.proto` it was written
with. Field names are the headers made valid and unique. Each file is
checked against its format's signature before the page offers it. CSV to
JPG, on the generic converter page, reads the CSV with the same parser
(`lib/convert/table-data.ts`, which reads a one-column CSV as one column)
and draws the same image, with the same notice when it's cut.

## Table downloads

Every table converter saves a file named after the
uploaded one (`sales.csv` saves as `sales.json`), or `table.<extension>` for
pasted text, with its format's media type (`OUTPUT_FILE_TYPES` in
`components/table-convert/formats.ts`; text is UTF-8, and a format without
an extension of its own saves as `.txt`). The name follows the input text's
origin, and the name and the output always describe the same table: every
change to the input, the table on screen and the name goes through one
reducer (`components/table-convert/output-state.ts`). A file's name is taken
only when its text is read into the input. Typing, a grid edit or another
input format edits that text and keeps the name; a change that replaces all
of the text (a paste over it), typing into an empty input, and Clear leave
no name. A read or parse that fails clears the table and the grid but keeps
the name, so text fixed by typing saves under it again. Download offers only
an output written from the table on screen, and nothing while a file is
read; a read that finishes after a newer file or an edit, and a grid edit
made on an earlier table, are dropped.

## Excel input (since #266)

An uploaded `.xlsx` (`components/table-convert/excel-input.ts`) is read by
the XLSX reader that draws workbooks as images
([document-images.md](document-images.md#xlsx-since-265)), in its worker,
loaded only then: each cell as Excel shows it, hidden sheets, rows and
columns left out. Every row and column of each visible sheet with values is
kept, up to 1,000,000 cells and 10,000,000 characters of text a workbook
(`TABLE_CELLS` and `TABLE_CHARS` in `lib/convert/excel-cells.ts`), counted
as values are read, before any text is built; a sheet that would take
either past it, or has a cell longer than Excel's 32,767 characters, is left
out, and the page names it. A million cells of short numbers are 6.9 million
characters and show in about 5 seconds. An Excel input's text is a sheet's
cells as Excel copies them: tab-separated, a cell in quotes, its quotes
doubled, when it holds a tab or a line break (and, as written here, a
quote). It is read as Excel writes it (`lib/convert/excel-cells.ts`): a
cell that starts with a quote but isn't quoted that way (`"Best" seller`, a
ditto mark) is its text. After an Excel upload (a workbook's sheet, or an
`.xls` that is text) the input's text is read-only (#299, the owner's
decision): the page says so, cells are edited in the grid, whose edits the
page writes back, and Clear view empties the input and makes it editable.
So the visitor's quotes never mix with text the page wrote, where a quote
can read two ways (ditto marks in a column copy as a quoted cell holding
line breaks would). Who wrote all of the text decides how it reads
(`written` in the reducer): text the page wrote (a sheet, a grid edit, a
rewrite in the input's format, a paste it wrote over all of the input),
untouched since, reads exactly as written. Any other text, typed or pasted
or edited, is read the visitor's way, which never merges rows on a quote
unless no reading keeps every line a row of one width, and then merges the
fewest lines that make every row as wide. Typing into text the page wrote
(not an Excel upload's, which is read-only) can split a cell holding line
breaks into rows: in one column, and in a table of two or more columns when
that cell's lines happen to be as wide as a row. A grid edit writes it back.
A paste takes the clipboard's plain text, which keeps each cell's text
exactly, and the HTML table Excel puts next to it decides its shape and the
text of a cell that starts with a quote (`excel-paste.ts`, scanned as text,
nothing rendered or fetched): when the visitor's reading differs, the page
puts the cells in its own way. Blank lines at the end aren't rows, as in a
CSV input; a row of empty cells (one added in the grid) is.
So cells pasted from Excel convert too, and a sheet reaches the table, the
name and Download through the reducer above like any file's text, under
the workbook's name. The first
visible sheet with values shows; when there are more, a select picks
another, which replaces the input's text from the same file, as last
edited: each sheet keeps its grid edits. The page says which sheet is
shown and what was left out. An `.xls` that is an OLE file (Excel 97-2003,
or a password-protected workbook) or Excel 2003 XML is refused with the
reader's message to save it as an unprotected `.xlsx`; one that is text,
as web apps' "Export to Excel" often writes, is read as its HTML table or
tab-separated cells.
On the Excel input, a file whose extension the page doesn't map is a
workbook when its first bytes are a ZIP's or an OLE file's, and text
otherwise (Excel's tab-delimited `.txt`).
