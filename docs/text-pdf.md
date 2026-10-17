# Text and XML to PDF

How TXT to PDF and XML to PDF (#283) lay out a file on PDF pages, which font
they use, how XML is listed, and when they refuse a file. Both run in the
browser (`lib/convert/text-pdf.ts`, with jsPDF loaded only when a file is
converted) and save `<original name>.pdf`, titled after the file. Paths are
under `apps/tools/`; [execution-paths.md](execution-paths.md) covers the other
engines.

## The page

A4 portrait, 3/4 inch (54 pt) margins, 10 pt type on 12 pt lines: 61 lines a
page and 81 characters a line in Courier, about what an 80-column printout
holds. A line longer than that wraps between words, inside a word too long for
a line, and its continuation lines are indented as far as the line itself (at
most 40 columns). Each character is measured once, so a line of millions of
characters wraps in one pass. Nothing else is added: no header, footer or page
numbers.

## TXT

The file is read as TXT to PNG reads it (`lib/convert/text-file.ts`, #265):
UTF-8 or UTF-16 by its byte order mark, else UTF-8, else Windows-1252; CR LF,
CR, LF, NEL and the Unicode line and paragraph separators break lines; tabs
stop every fourth column; control characters and terminal escape sequences are
dropped. A form feed starts a new page, as on a printer, so a file paginated
with form feeds (an RFC, a report) keeps its pages. Blank lines and leading
spaces are kept; blank lines at the end are not. A line whose first letter is
Hebrew or Arabic is set against the right margin, as an editor shows it.

## XML

`lib/convert/xml-listing.ts` reads the file with sax, in strict mode, and lists
it a line a node: each element with its attributes in source order, two
columns further in a level (up to 20 levels; deeper ones share the 20th's
indent), its text beside it when that's all it holds, else its text lines
trimmed inside it. CDATA keeps its lines; comments, processing instructions
and the DOCTYPE are grey. The encoding comes from the byte order mark, a
UTF-16 `<?`, the XML declaration (any label the browser's `TextDecoder`
knows), else as for TXT.

Entities are never expanded or fetched. XML's five (`&amp;` `&lt;` `&gt;`
`&quot;` `&apos;`) and character references are read; any other reference,
declared in the DOCTYPE or not, is shown as written. A "billion laughs" file,
an external entity or an XHTML `&nbsp;` costs only its own text. A file sax
rejects is refused with sax's message and the line and column it stopped at.
sax accepts two things XML doesn't, and the listing catches one: a second root
element is refused, but a repeated attribute keeps its first value unseen.

## Fonts

Text that is all Windows-1252 is set in jsPDF's built-in Courier: every
character is one width, so spaced-out columns line up, and no font is fetched.
Anything else sets the whole file in DejaVu Sans, the self-hosted font table
PDFs use (`lib/convert/pdf-font.ts`, #249), fetched once a page and embedded
once. Its letters vary in width, so columns made with spaces don't line up,
but indentation does: it is placed in Courier's columns, not as spaces.
Right-to-left text is drawn in display order and Arabic joined, as in table
PDFs. Text is composed (NFC) first, so an accent typed as a separate mark
stays in Courier, and invisible characters (C1 controls, zero-width spaces and
joiners, direction marks, soft hyphens, variation selectors) are dropped.

## Limits and refusals

| Code | When | The page says |
| --- | --- | --- |
| `too_large` | over 20 MB, before the file is read (`checkInputFile`), or over 2,000 pages, counted as it is laid out and stopped there | which limit, and its size |
| `unsupported_script` | a character DejaVu Sans has no glyph for: Chinese, Japanese, Korean, Indic, Thai, emoji | the characters, up to six, and (TXT) that TXT to PNG draws them |
| `malformed_xml` | sax rejects the file, a second root element, or no element at all | sax's message, with line and column |
| `unsupported_encoding` | the XML declaration names an encoding the browser can't decode, or bytes that aren't in it | save it as UTF-8 |
| `no_text` | nothing but whitespace and control characters | it is empty |

The limits are the PDF's size in the tab's memory. jsPDF 4.2.1 wrote 2,000 full
pages in about 2 seconds and 120 MB of heap in Node in Courier, and 3 seconds
and 230 MB in DejaVu Sans; 2,000 pages hold about 10 million characters, which
is also PDF to TXT's page limit. 20 MB bounds what is read before the page
count is known. Any other failure (jsPDF or the font didn't load) says the
file couldn't be converted and to try again, with code `convert_failed` and
engine `text-pdf` or `xml-pdf`.

## Known gaps

- A text file in a legacy encoding other than Windows-1252 (Shift_JIS, KOI8-R)
  is read as Windows-1252, as by TXT to PNG and a browser, and set as such.
- XML is listed, not rendered: no XSLT, XSL-FO or e-invoice layout.

## Verification

`lib/convert/text-pdf.test.mjs` reads each PDF back with pdf.js: the text, its
position and its font. `benchmarks/make-text-fixtures.mjs` writes the two
refusal fixtures, and the test checks it still writes the committed bytes. The
sweep opens the PDF as PDF to TXT reads one and looks for `sample.txt`'s and
`sample.xml`'s markers, and runs `sample-cjk.txt` and `sample-malformed.xml`
as refusals ([tool-verification.md](runbooks/tool-verification.md#tool-sweep)).
