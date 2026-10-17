// Draws the share images (og:image, twitter:image) listed in
// lib/share-images.ts into public/og/ as 1200x630 PNGs (issue #320):
//
//   pnpm -C apps/tools share-images
//
// It uses Next.js's own image renderer (next/og) with Liberation Sans from
// pdfjs-dist's standard fonts, so every machine draws the same pictures. Run
// it after changing lib/share-images.ts and commit the PNGs;
// lib/share-images.test.mjs fails when a file is missing or another size.

import { Buffer } from "node:buffer";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SHARE_IMAGES, SHARE_IMAGE_HEIGHT, SHARE_IMAGE_WIDTH } from "../lib/share-images.ts";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(appRoot, "package.json"));
const { ImageResponse } = await import(require.resolve("next/og"));
const { createElement: h } = require("react");

const fontDir = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts");
const FONT = "Liberation Sans";
const fonts = [
  { name: FONT, data: readFileSync(path.join(fontDir, "LiberationSans-Regular.ttf")), weight: 400 },
  { name: FONT, data: readFileSync(path.join(fontDir, "LiberationSans-Bold.ttf")), weight: 700 },
];

const INK = "#171717";
const MUTED = "#525252";
const LINE = "#e5e5e5";

function chip(label) {
  return h(
    "div",
    {
      key: label,
      style: {
        display: "flex",
        padding: "10px 22px",
        marginRight: 16,
        marginBottom: 12,
        border: `2px solid ${LINE}`,
        borderRadius: 999,
        background: "#fafafa",
        fontSize: 28,
        color: INK,
      },
    },
    label,
  );
}

function design({ title, subtitle, chips, accent }) {
  return h(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        background: "#ffffff",
        fontFamily: FONT,
        color: INK,
      },
    },
    h("div", { style: { display: "flex", width: 24, height: "100%", background: accent } }),
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          flexGrow: 1,
          padding: "64px 72px 56px 72px",
        },
      },
      h(
        "div",
        { style: { display: "flex", alignItems: "center", fontSize: 40, fontWeight: 700 } },
        h(
          "div",
          {
            style: {
              display: "flex",
              padding: "6px 16px",
              marginRight: 14,
              borderRadius: 12,
              background: INK,
              color: "#ffffff",
            },
          },
          "SERP",
        ),
        "Tools",
      ),
      h(
        "div",
        { style: { display: "flex", flexDirection: "column" } },
        h("div", { style: { display: "flex", fontSize: 84, fontWeight: 700, lineHeight: 1.05 } }, title),
        h(
          "div",
          { style: { display: "flex", marginTop: 22, maxWidth: 980, fontSize: 36, lineHeight: 1.3, color: MUTED } },
          subtitle,
        ),
        chips.length > 0
          ? h("div", { style: { display: "flex", flexWrap: "wrap", marginTop: 36 } }, ...chips.map(chip))
          : null,
      ),
      h("div", { style: { display: "flex", fontSize: 30, fontWeight: 700, color: accent } }, "tools.serp.co"),
    ),
  );
}

const outDir = path.join(appRoot, "public");
for (const [name, image] of Object.entries(SHARE_IMAGES)) {
  const response = new ImageResponse(design(image), {
    width: SHARE_IMAGE_WIDTH,
    height: SHARE_IMAGE_HEIGHT,
    fonts,
  });
  const png = Buffer.from(await response.arrayBuffer());
  const file = path.join(outDir, image.path);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, png);
  console.log(`${name}: ${image.path} (${png.length.toLocaleString("en-US")} B)`);
}
