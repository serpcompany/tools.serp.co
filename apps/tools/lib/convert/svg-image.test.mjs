import test from "node:test";
import assert from "node:assert/strict";

import { MAX_IMAGE_SIDE } from "./document-images.ts";
import { prepareSvgForImage, svgImageSize, svgSize } from "./svg-image.ts";

test("an SVG's size comes from its root, in points", () => {
  assert.deepEqual(svgSize('<svg width="62pt" height="116pt"\n viewBox="0.00 0.00 62.00 116.00">'), { width: 62, height: 116 });
  assert.deepEqual(svgSize('<svg width="80px" height="40px">'), { width: 60, height: 30 });
  assert.deepEqual(svgSize('<svg viewBox="0 0 960 540" width="960" height="540">'), { width: 720, height: 405 });
  assert.deepEqual(svgSize('<svg viewBox="0 0 10 20">'), { width: 10, height: 20 });
  assert.equal(svgSize("<html>"), null);
});

test("an image is `scale` pixels a point, or smaller to fit 4096 px", () => {
  assert.deepEqual(svgImageSize(62, 116, 2), { width: 124, height: 232, scale: 2 });
  assert.deepEqual(svgImageSize(720, 405, 2), { width: 1440, height: 810, scale: 2 });
  const wide = svgImageSize(40_045, 1_124, 2);
  assert.equal(wide.width, MAX_IMAGE_SIDE);
  assert.ok(wide.height < MAX_IMAGE_SIDE && wide.height > 100);
  assert.ok(wide.scale < 1);
});

test("the SVG drawn loses stylesheet links and outside images, and takes the image's size", () => {
  const svg =
    '<?xml version="1.0"?>\n<?xml-stylesheet href="https://example.net/s.css" type="text/css"?>\n' +
    '<svg width="62pt" height="116pt" viewBox="0 0 62 116" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
    '<image xlink:href="https://example.net/i.png" width="10" height="10" preserveAspectRatio="xMinYMin meet" x="0" y="0"/>' +
    "<image href='/hostile/picture.png' width='10' height='10'></image>" +
    '<image xlink:href="data:image/png;base64,AAAA" width="1" height="1"/>' +
    '<g id="a"><a xlink:href="https://example.net/x"><text>A</text></a></g></svg>';
  const prepared = prepareSvgForImage(svg, 124, 232);
  assert.ok(!prepared.includes("xml-stylesheet"));
  assert.ok(!prepared.includes("example.net/i.png"));
  assert.ok(!prepared.includes("/hostile/"));
  assert.ok(prepared.includes("data:image/png;base64,AAAA"));
  assert.match(prepared, /<svg width="124" height="232" preserveAspectRatio="none" viewBox="0 0 62 116"/);
  assert.equal((prepared.match(/<svg\b[^>]*>/)[0].match(/\swidth=/g) ?? []).length, 1);
});

test("text that names no font gets the font asked for, and only that one", () => {
  const svg = '<svg width="10" height="10" font-family="Times"><text>x</text></svg>';
  assert.match(prepareSvgForImage(svg, 20, 20, "'Segoe UI', sans-serif"), /^<svg width="20" height="20" preserveAspectRatio="none" font-family="'Segoe UI', sans-serif">/);
  assert.doesNotMatch(prepareSvgForImage(svg, 20, 20, '"><script>alert(1)</script>'), /<script/);
  assert.match(prepareSvgForImage(svg, 20, 20), /font-family="Times"/);
});
