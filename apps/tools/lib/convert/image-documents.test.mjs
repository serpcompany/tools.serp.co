import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";

import { imageToEpub, isImageDocumentConversion, svgPageSize, svgToHtml } from "./image-documents.ts";
import { checkOutputFormat } from "./output-format.ts";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../benchmarks/fixtures");
const read = (name) => {
  const bytes = readFileSync(path.join(fixtures, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const text = (buffer) => new TextDecoder().decode(buffer);

test("SVG to HTML embeds the drawing in a standalone UTF-8 page", () => {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>Café</text></svg>\n`;
  const html = text(svgToHtml(new TextEncoder().encode(svg).buffer, "logo.svg"));
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<title>logo<\/title>/);
  assert.match(html, /<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="10" height="10"><text>Café<\/text><\/svg>/);
  assert.ok(!html.includes("<?xml"));
  assert.ok(!html.includes("<!DOCTYPE svg"));
});

test("SVG to HTML escapes the title and refuses a file with no SVG", () => {
  const svg = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg"/>`).buffer;
  assert.match(text(svgToHtml(svg, "<b>&.svg")), /<title>&lt;b&gt;&amp;<\/title>/);
  assert.throws(() => svgToHtml(new TextEncoder().encode("<html></html>").buffer, "x.svg"), /no SVG/);
});

test("SVG to HTML skips an <svg mention inside a leading comment, and takes <svg/>", () => {
  const encode = (value) => new TextEncoder().encode(value).buffer;
  const html = text(svgToHtml(encode(`<!-- made with <svg > tool --><svg xmlns="http://www.w3.org/2000/svg"/>`), "a.svg"));
  assert.match(html, /<body>\n<svg xmlns="http:\/\/www.w3.org\/2000\/svg"\/>\n<\/body>/);
  assert.match(text(svgToHtml(encode("<svg/>"), "a.svg")), /<body>\n<svg\/>/);
});

// One SVG user unit is one point, as Illustrator reads and writes SVG.
test("the AI page takes the SVG's size in points, from units or the viewBox", () => {
  const size = (width, height, viewBox) => svgPageSize({ width, height, viewBox });
  assert.deepEqual(size("200", "100", null), { width: 200, height: 100 });
  assert.deepEqual(size("200px", "100pt", null), { width: 200, height: 100 });
  const cm = size("10cm", "5cm", null);
  assert.ok(Math.abs(cm.width - 283.46) < 0.01 && Math.abs(cm.height - 141.73) < 0.01, JSON.stringify(cm));
  assert.deepEqual(size("1in", "6pc", null), { width: 72, height: 72 });
  assert.deepEqual(size("100%", "100%", "0 0 800 400"), { width: 800, height: 400 });
  assert.deepEqual(size("200", null, "0 0 100 50"), { width: 200, height: 100 });
  assert.deepEqual(size(null, "25mm", "0,0,2,1").width.toFixed(2), (25 * 72 / 25.4 * 2).toFixed(2));
  assert.deepEqual(size(null, null, null), { width: 300, height: 150 });
});

test("an image becomes a one-page EPUB 3 with the mimetype stored first", () => {
  const png = read("sample.png");
  const epub = imageToEpub(png, "png", "sample.png");
  assert.equal(checkOutputFormat(epub, "epub").ok, true);

  const bytes = new Uint8Array(epub);
  // The OCF rule: "mimetype" is the first entry, stored (method 0), unpadded.
  assert.equal(strFromU8(bytes.subarray(30, 38)), "mimetype");
  assert.equal(bytes[8] | (bytes[9] << 8), 0);
  assert.equal(strFromU8(bytes.subarray(38, 58)), "application/epub+zip");

  const files = unzipSync(bytes);
  assert.match(strFromU8(files["META-INF/container.xml"]), /full-path="OEBPS\/content.opf"/);
  const opf = strFromU8(files["OEBPS/content.opf"]);
  assert.match(opf, /<package[^>]*version="3.0"/);
  assert.match(opf, /<dc:title>sample<\/dc:title>/);
  assert.match(opf, /<dc:identifier id="book-id">urn:uuid:[0-9a-f-]{36}<\/dc:identifier>/);
  assert.match(opf, /<meta property="dcterms:modified">\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ<\/meta>/);
  assert.match(opf, /href="image.png" media-type="image\/png"/);
  assert.match(opf, /properties="nav"/);
  assert.match(strFromU8(files["OEBPS/page.xhtml"]), /<img src="image.png" alt="sample"\/>/);
  assert.deepEqual(files["OEBPS/image.png"], new Uint8Array(png));
});

test("only the conversions this module writes are routed to it", () => {
  for (const [from, to] of [["svg", "html"], ["svg", "ai"], ["png", "epub"], ["jpg", "epub"]]) {
    assert.equal(isImageDocumentConversion(from, to), true, `${from} to ${to}`);
  }
  for (const [from, to] of [["svg", "png"], ["png", "ai"], ["csv", "html"], ["markdown", "html"]]) {
    assert.equal(isImageDocumentConversion(from, to), false, `${from} to ${to}`);
  }
});

test("AI, PCD, EPUB and HTML outputs have signatures", () => {
  const pcd = new Uint8Array(3000);
  pcd.set(new TextEncoder().encode("PCD_IPI"), 2048);
  assert.equal(checkOutputFormat(pcd.buffer, "pcd").ok, true);
  assert.equal(checkOutputFormat(new Uint8Array(3000).buffer, "pcd").ok, false);
  assert.equal(checkOutputFormat(new TextEncoder().encode("%PDF-1.7").buffer, "ai").ok, true);
  assert.equal(checkOutputFormat(read("sample.png"), "ai").ok, false);
  assert.equal(checkOutputFormat(read("sample.png"), "epub").ok, false);
  // No HTML signature: table converters save an HTML fragment, not a page.
  assert.equal(checkOutputFormat(new TextEncoder().encode("<table></table>").buffer, "html").ok, true);
});
