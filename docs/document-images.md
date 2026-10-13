# Documents to images

How DOCX, DXF, HTML, plain text, Graphviz DOT, XLSX and PPTX files become
images in the visitor's browser, and which document inputs don't convert and
why. Paths are under `apps/tools/`. [execution-paths.md](execution-paths.md)
covers the other engines and the server routes.

## The shared path

`isDocumentImageConversion` (`lib/convert/image-document-targets.ts`) sends
these inputs to `lib/convert/document-images.ts`, on the main thread, which
loads each renderer only when its input is converted. Each picture is then
encoded as any image is (`encode.ts`): an SVG is the PNG wrapped, not text or
vectors, and a TIFF is LZW. No side of an image passes 4096 px, Safari's canvas
limit. A file with several pages, sheets or slides becomes one image each,
saved as `name_page1`, `name_page2` in order, a slide as `name_slide3` (its
own number, hidden slides counted) and a sheet as `name_Sales` (its name, made
safe for a file name, `_2` on a repeat); the page says which is which and what
was left out. `DOCUMENT_IMAGE_ENGINES` names each renderer for
telemetry and the Tool sweep.

## HTML and DOCX (since #250)

An HTML file is parsed without running or loading anything (DOMParser) and
loses what runs, loads or embeds: scripts, `<base>`, `<link>`,
`<meta http-equiv>`, frames, objects, event attributes, any SVG `<use>` that
points outside the page (read as the URL parser reads it), audio, and video (an
image of its poster when the file holds it); the `<use>`, audio and video rules
run again on the sandbox's own copy. It's then laid out 1280 px wide, in an
800 px window for `vh` units, in an off-screen
`<iframe sandbox="allow-same-origin">` with no `allow-scripts`, whose `srcdoc`
starts with a Content Security Policy allowing only inline styles and `data:`
images and fonts, so nothing is fetched from this site or any other.
modern-screenshot 4.7.0 copies it into an SVG foreignObject and draws it; its
own fetches run outside the sandbox, so it gets only the `data:` fonts and
images in the file, and a blank image for any other. The picture is as tall as
the page, up to 4096 px; a taller page is cut there and the page says so.

A DOCX is laid out by docx-preview 0.4.1 in the same kind of sandbox, every
node built in the sandbox's document (its `h` option), so a picture the file
links to but doesn't hold loads nothing; one file a page, at twice its size in
points as a PDF page is (1224x1584 for US Letter). Pages break where the file
says, and where text runs past a page's height, between paragraphs or table
rows, with the header and footer repeated; a table continues with its header
rows (`w:tblHeader`) and its columns, and a cell merged down across the break
continues, empty, on the next page; a file with no page size is US Letter with
1-inch margins. List numbers are written out as text, since the capture drops
CSS counters; numbering in other scripts (CJK, Hebrew) comes out as decimal.
Fonts the browser doesn't have fall back to its default, and an altChunk (HTML
inside the file) is left out.

## DXF (since #250)

dxf-viewer 1.0.49 (three.js and WebGL) draws the drawing on white, 2048 px on
its longer side, with its TEXT and MTEXT in DejaVu Sans 2.37
(`public/vendor/fonts/dejavu/`, the font table PDFs use). A browser without
WebGL is told so (`webgl_unavailable`).

## Plain text (since #265)

`lib/convert/text-image.ts` draws the text on a canvas, black on white, 16 px
on 24 px lines with 32 px margins, in DejaVu Sans, which covers Latin, Greek,
Cyrillic, Hebrew and Arabic; other scripts (CJK, emoji) fall back to the
browser's sans-serif. The file is read as UTF-8, or UTF-16 by its byte order
mark, else as Windows-1252. Lines wrap between words at 800 px (about 90
characters), and inside a word too long for a line; tabs stop every 4
characters, and terminal colour codes and other control characters go. A line
whose first letter is Hebrew or Arabic is drawn right to left. The image is as
wide as its longest line, drawn at twice its size, or less when the text is
taller than 2048 px, but never smaller than its size: at most 168 lines. A longer text
stops there, its last line saying at which of its lines, and the page says so;
only the lines shown are measured, so a 50,000-line file draws in about a
second. As SVG it's the picture wrapped, so its text isn't editable, as the
TXT to SVG page says.

## Graphviz DOT (since #265)

Viz.js 3.31.0 (`@viz-js/viz`, MIT; Graphviz 16.1.0, EPL, compiled to
WebAssembly) lays the graph out as SVG in a worker
(`lib/convert/graphviz.worker.ts`). Its WebAssembly is inside the worker's own
script, served from `/_next/static/` and loaded only when a DOT file is
converted. Graphviz reads files only from the module's in-memory file system,
which holds none of the visitor's files, so `image`, `shapefile`, HTML-label
`<IMG>` and `fontpath` find nothing and nothing is fetched; the page says
pictures and shape files the graph names aren't drawn. The worker first
removes the devices a graph could read without end (`/dev/urandom` named as an
EPSF shape file kept Graphviz reading until the tab ran out of memory).
`lib/convert/graphviz-image.ts` refuses a file over 2 MB, and stops a layout
still running after 60 s by terminating the worker (`layout_timeout`). A graph
with more than 1,000 edges gets Graphviz's limits on its slowest steps
(`mclimit=0.1`, `nslimit=1`, `nslimit1=1`) unless it sets its own: a random
2,000-node graph with 3,000 edges took 150 s without them and 15 s with them in
Chromium; a 2,000-node tree takes a fraction of a second. A file holding
several graphs draws the first. The SVG loses any
`xml-stylesheet` link and any picture that isn't a `data:` URL, and is drawn
through an `<img>` (`lib/convert/svg-image.ts`), which runs nothing and loads
nothing, at twice its size in points; a graph too big for that is drawn smaller
to fit 4096 px, and the page says so.

## XLSX (since #265)

`lib/convert/xlsx-sheets.ts` reads the workbook with fflate and a small XML
scanner (`lib/convert/ooxml.ts`) in a worker (`lib/convert/xlsx.worker.ts`,
started by `xlsx-workbook.ts`) stopped after 60 s (`layout_timeout`). It
inflates a part only when it's needed and only up to the size its ZIP entry
declares, refuses a sheet that declares more than 64 MB, and stops reading
sheets once the parts read add up to 256 MB (a sheet part two sheets name is
read once). A row or cell numbered outside Excel's grid (1,048,576 rows,
16,384 columns) is left out. Each sheet that shows becomes an image drawn as the table
converters draw a table (`table-image.ts`): its first row as the header, as
many rows and columns as fit, and a note in the image when some don't. Hidden
and very hidden sheets, hidden rows and hidden columns are left out, as Excel
leaves them out of a printout, and the page counts the hidden sheets. A cell
shows what Excel shows (`lib/convert/excel-number-format.ts`): General,
decimals, thousands separators, percentages, scientific notation, currency
and other text in the format, dates and times (1900 and 1904 date systems),
fractions, TRUE and FALSE, error values, and a formula's saved result. Text
goes through the format's text section, and a section left empty hides the
value, as in Excel (`;;;`, `0;-0;;@`). Cells keep the table renderer's left
alignment. A merged cell shows its value in its first cell; charts, pictures,
comments and colours aren't drawn, and at most 100 sheets with values become
images. 10,000 rows in three
sheets read in about half a second; rows past the first 500 with values are
counted, not kept. An XLS file, or a workbook saved with a password, is told to
save it again as an unprotected `.xlsx`.

## PPTX (since #265)

pptx-glimpse 5.3.1 (MIT) draws each slide that shows as SVG in a worker
(`lib/convert/pptx.worker.ts`), ten slides a worker so a long presentation's
SVGs aren't all held at once, all stopped after 90 s (`layout_timeout`), and
`lib/convert/pptx-slides.ts` picks the slides that show by part, reading the
slide list as pptx-glimpse reads it (each `<p:sldId>`'s `r:id`), and the
worker numbers them from pptx-glimpse's own list (`readPptx` from
`@pptx-glimpse/document` 0.16.0), so a hidden slide is never drawn in a
visible one's place. It draws each SVG through an `<img>` at twice the
slide's size in points (1440x810 for a 10-inch 16:9 slide, 1920x1080 for
PowerPoint's 13.33-inch one), encoding each slide before drawing the next.
Text is SVG text in the slide's own fonts with metric-compatible fallbacks,
drawn with the visitor's fonts, so no font file is fetched; text that names no
font gets the theme's body font, then sans-serif. Hidden slides
(`<p:sld show="0">`), speaker notes and comments aren't drawn, and the page
counts the hidden slides. A picture the slide links to instead of holding, and
video, aren't drawn, and the page counts what pptx-glimpse left out. At most
100 slides become images, and the page says how many there were. A package
whose parts declare more than 512 MB inflated isn't read. A PPT file, or one
saved with a password, is told to save it again as an unprotected `.pptx`.
`next.config.mjs` points `pptx-glimpse` at its browser build, which its
package exports only under a `browser` condition this build doesn't use.

## Not drawn

`odt-to-jpg`, `ps-to-jpg`, `ps-to-png` and `fig-to-tiff` are retired (#265,
the owner's decision): no maintained, permissive renderer runs ODT, PostScript
or XFig in the browser. LibreOffice in WebAssembly is ruled out for now,
Ghostscript is AGPL (#244), the one ODT preview package reads only headings
and paragraphs, and no maintained XFig reader exists for the browser. ODT to
JPG comes back with a reader of our own (#297).
