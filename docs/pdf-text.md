# PDF to text, HTML and EPUB

How PDF to TXT, PDF to HTML and PDF to EPUB (#282) read a PDF's text and write
it, what they leave out, and when they refuse a file. All three run in the
browser (`lib/convert/pdf-text.ts`) and save `<original name>.<ext>`; "pdf to
text" is PDF to TXT's alias page. Paths are under `apps/tools/`;
[execution-paths.md](execution-paths.md) covers the other engines.

## Reading the text

pdf.js (the copy in `public/vendor/pdfjs/`, 5.4.296; Node has `pdfjs-dist` 6)
streams each page's text runs (`streamTextContent`) in the order the PDF
stores them, which is usually reading order. A line ends where pdf.js marks
one (`hasEOL`), and its spaces are collapsed. A paragraph ends at an empty
line, where the next line is higher up the page (the next column or block),
where the font size changes by more than a fifth (a heading), or where the gap
to the next line is over 1.3 times the page's usual spacing: the lower quartile
of its line gaps, or 1.2 font sizes on a page with fewer than four lines, and
never more than 4 font sizes. Lines half a font size apart or less (cells of
one row) stay together.

Only the text is kept: no layout, fonts, tables, images, links, annotations or
form fields. A table's cells come out as lines. Columns stored one after the
other stay whole; columns stored a row at a time come out mixed. A word broken
with a hyphen at a line's end keeps the hyphen. There is no OCR.

## The files

- **TXT:** UTF-8 with no byte-order mark. A paragraph's lines stay on lines of
  their own, with a blank line after each paragraph and between pages.
- **HTML:** one page, a `<section id="page-N">` a page and a `<p>` a
  paragraph, its lines joined by spaces so it rewraps. Its
  Content-Security-Policy (`default-src 'none'; style-src 'unsafe-inline'`)
  lets it load and run nothing.
- **EPUB:** a reflowable EPUB 3 from `writeEpub` in
  `lib/convert/image-documents.ts`, which also writes an image's one-page EPUB:
  `mimetype` first and stored, then the container, the package, a navigation
  document listing "Page 1", "Page 2"..., and a `page-N.xhtml` a page, in spine
  order, its paragraphs as in the HTML.

Both HTML and EPUB are titled with the file's name, in the language the PDF's
`/Lang` names when it is a BCP 47 tag, else English. A page with no text is an
empty section (HTML) or document (EPUB) and adds nothing to the TXT, and the
page says which pages had none when some did: each may be a scan or blank.

## Untrusted text

A PDF's text can hold anything. `cleanText` cleans each run once, as it is
read: it drops what XML 1.0 forbids (C0 controls other than tab, LF and CR,
lone surrogates, U+FFFE and U+FFFF), DEL and C1 controls, and turns tabs and
line breaks into spaces, since lines come from where the runs are. Every
string written into HTML or XHTML, file names included, goes through
`escapeXml`, which drops the forbidden characters again and escapes markup, so
`<script>` is text and the EPUB always parses. pdf.js runs with
`isEvalSupported: false`.

## Limits and refusals

pdf.js runs in its own `PDFWorker`, stopped once the text is read. Each limit
counts exactly, so a file is never refused while a larger one converts:

| Code | When | The page says |
| --- | --- | --- |
| `unreadable_pdf` | pdf.js throws `InvalidPDFException`: not a PDF, empty, or cut short past repair | it may be damaged or incomplete, or not a PDF |
| `password_protected` | pdf.js throws `PasswordException` (an owner password alone opens and converts) | open it, save or print a copy without the password |
| `no_text` | no page has any text but spaces, as in a scan or a blank PDF | it has no text to extract (a scan, or blank); OCR isn't done |
| `too_large` | over 2,000 pages (`numPages`, before reading), or over 20 million characters of pdf.js's text, counted as it streams | which limit, and its size |
| `read_timeout` | over 2 minutes; the worker is stopped even if it hangs | it took too long |

Any other failure says the PDF couldn't be converted and to try again;
telemetry keeps pdf.js's error name as the code (`UnknownErrorException` when
its worker failed), or `convert_failed`, with engine `pdfjs-text`. No empty file
is ever saved.

## Known gaps

- Chinese, Japanese and Korean text in a font with no ToUnicode map that relies
  on one of Adobe's predefined CMaps needs pdf.js's CMap files
  (`pdfjs-dist/cmaps`, 169 files, 1.6 MB), which aren't self-hosted. pdf.js
  drops that text, and a PDF with only such text is refused as having none.
- PDF to PNG and PDF to JPG still show pdf.js's own message for a damaged or
  password-protected PDF.

## Verification

`benchmarks/make-pdf-fixtures.mjs` writes the fixtures (`sample-text.pdf` and
the three refusals), and `lib/convert/pdf-text.test.mjs` checks it still writes
the committed bytes. `pnpm test` runs that file twice: on `pdfjs-dist`, and
through `pdf-text.vendored.test.mjs` on the vendored copy the browser loads,
since the two versions differ (5.4 reads the tests' unembedded Helvetica's
codes below 0x20 as spaces, so they draw characters from 0x20 up). The sweep
looks for `sample-text.pdf`'s markers in the TXT, in the HTML's body text and
in the EPUB's spine documents, which it parses strictly, and runs each refusal
on all three pages
([tool-verification.md](runbooks/tool-verification.md#tool-sweep)).
