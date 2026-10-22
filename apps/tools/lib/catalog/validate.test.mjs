import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { validateCatalog } from "./validate.ts";

const registry = JSON.parse(readFileSync(new URL("./tools.json", import.meta.url), "utf8"));

const entry = (overrides = {}) => ({
  id: "png-to-jpg",
  name: "PNG to JPG",
  description: "Convert PNG images to JPG format",
  operation: "convert",
  route: "/png-to-jpg",
  from: "png",
  to: "jpg",
  isActive: true,
  ...overrides,
});

const content = (overrides = {}) => ({
  tool: { title: "PNG to JPG", subtitle: "Convert PNG to JPG", from: "png", to: "jpg" },
  faqs: [{ question: "Is it free?", answer: "Yes." }],
  ...overrides,
});

test("the registry matches the Tool type", () => {
  assert.deepEqual(validateCatalog(registry), []);
});

test("a valid entry with content passes", () => {
  assert.deepEqual(validateCatalog([entry({ content: content(), tags: ["png"], requiresFFmpeg: false })]), []);
});

test("ids and public paths are unique", () => {
  assert.deepEqual(
    validateCatalog([entry(), entry({ route: "/png-to-jpeg" }), entry({ id: "png-to-jpeg" })]),
    ["png-to-jpg: duplicate id", "png-to-jpeg: duplicate route /png-to-jpg/"],
  );
  // /png-to-png/ redirects to /compress-png/, so these two collide.
  assert.deepEqual(
    validateCatalog([
      entry({ id: "png-to-png", route: "/compress-png" }),
      entry({ id: "png-to-png-2", route: "/png-to-png" }),
    ]),
    ["png-to-png-2: duplicate route /compress-png/"],
  );
});

test("the operation must be one of OPERATIONS", () => {
  const [error] = validateCatalog([entry({ operation: "resize" })]);
  assert.match(error, /^png-to-jpg\.operation is "resize", not one of convert, download, .*view/);
});

test("required fields, types and route format are checked", () => {
  assert.deepEqual(
    validateCatalog([
      entry({ name: "", isActive: "yes", route: "/PNG-to-jpg/", priority: "high", tags: "png" }),
    ]),
    [
      "png-to-jpg.name must be a non-empty string",
      'png-to-jpg.route must look like /lowercase-words with no trailing slash, got "/PNG-to-jpg/"',
      "png-to-jpg.isActive must be a boolean",
      "png-to-jpg.tags must be an array",
      "png-to-jpg.priority must be a number",
    ],
  );
  assert.deepEqual(validateCatalog([null]), ["[0] must be an object"]);
  assert.deepEqual(validateCatalog({}), ["the registry must be an array of Tools"]);
});

test("unknown fields are reported, at the top level and in content", () => {
  assert.deepEqual(
    validateCatalog([entry({ isFeatured: true, content: content({ faq: [] }) })]),
    ["png-to-jpg.isFeatured is not a known field", "png-to-jpg.content.faq is not a known field"],
  );
  // Object.prototype names are fields like any other.
  const [parsed] = JSON.parse(
    JSON.stringify([entry()]).replace('"isActive"', '"constructor":1,"__proto__":{},"toString":"x","isActive"'),
  );
  assert.deepEqual(validateCatalog([parsed]), [
    "png-to-jpg.constructor is not a known field",
    "png-to-jpg.__proto__ is not a known field",
    "png-to-jpg.toString is not a known field",
  ]);
});

test("content follows ToolContent", () => {
  assert.deepEqual(
    validateCatalog([
      entry({
        content: content({
          tool: { subtitle: "Convert", from: "png", to: "jpg" },
          faqs: [{ question: "Is it free?" }],
          howTo: { title: "How to", steps: "Upload" },
          reviews: [{ author: "A", body: "Good", rating: "5" }],
        }),
      }),
    ]),
    [
      "png-to-jpg.content.tool.title must be a non-empty string",
      "png-to-jpg.content.faqs[0].answer must be a non-empty string",
      "png-to-jpg.content.reviews[0].rating must be a number",
      "png-to-jpg.content.howTo.steps must be an array",
    ],
  );
});

const video = (overrides = {}) => ({
  id: "FJkyr2TEUs0",
  title: "How to Convert WebP to PNG (Free Method)",
  description: "WebP to PNG Convert: https://tools.serp.co/webp-to-png/",
  uploadDate: "2026-10-22T00:15:20-07:00",
  duration: "PT28S",
  ...overrides,
});

test("a video has the id, text, upload date and duration its watch page and the video sitemap need", () => {
  assert.deepEqual(validateCatalog([entry({ video: video() })]), []);
  assert.deepEqual(
    validateCatalog([entry({ video: video({ uploadDate: "2026-10-22T07:15:20Z", duration: "PT1H2M3S" }) })]),
    [],
  );

  assert.deepEqual(
    validateCatalog([
      entry({
        video: {
          youtubeId: "FJkyr2TEUs0",
          id: "https://youtu.be/FJkyr2TEUs0",
          uploadDate: "2026-10-22",
          duration: "28",
        },
      }),
    ]),
    [
      "png-to-jpg.video.youtubeId is not a known field",
      'png-to-jpg.video.id must be an 11-character YouTube video id, got "https://youtu.be/FJkyr2TEUs0"',
      "png-to-jpg.video.title must be a non-empty string",
      "png-to-jpg.video.description must be a non-empty string",
      'png-to-jpg.video.uploadDate must be an ISO 8601 date and time with a time zone, e.g. 2026-10-22T00:15:20-07:00, got "2026-10-22"',
      'png-to-jpg.video.duration must be an ISO 8601 duration in hours, minutes and seconds, e.g. PT28S, got "28"',
    ],
  );
  // A bare id string, as the retired field held, is not a video.
  assert.deepEqual(validateCatalog([entry({ video: "FJkyr2TEUs0" })]), ["png-to-jpg.video must be an object"]);
  assert.match(validateCatalog([entry({ video: video({ duration: "PT" }) })])[0], /video\.duration must be an ISO 8601 duration/);
  assert.match(
    validateCatalog([entry({ video: video({ uploadDate: "2026-13-45T99:00:00Z" }) })])[0],
    /video\.uploadDate is not a real date/,
  );
});

test("a video's description is plain text that fits the video sitemap", () => {
  assert.deepEqual(validateCatalog([entry({ video: video({ description: "x".repeat(2048) }) })]), []);
  assert.deepEqual(validateCatalog([entry({ video: video({ description: "x".repeat(2049) }) })]), [
    "png-to-jpg.video.description must be at most 2048 characters, got 2049",
  ]);
  assert.deepEqual(validateCatalog([entry({ video: video({ description: "Open <b>the</b> converter." }) })]), [
    "png-to-jpg.video.description must be plain text, not HTML",
  ]);
  // A comparison is text, not a tag.
  assert.deepEqual(validateCatalog([entry({ video: video({ description: "PNG < 5 MB and JPG > 1 MB." }) })]), []);
});

test("no two videos share an id, a title or a description", () => {
  const other = entry({ id: "png-to-jpeg", route: "/png-to-jpeg" });
  assert.deepEqual(
    validateCatalog([
      entry({ video: video() }),
      { ...other, video: video({ title: "Another title", description: "Another description." }) },
    ]),
    ["png-to-jpeg.video.id repeats png-to-jpg's"],
  );
  assert.deepEqual(
    validateCatalog([entry({ video: video() }), { ...other, video: video({ id: "AAAAAAAAAAA" }) }]),
    ["png-to-jpeg.video.title repeats png-to-jpg's", "png-to-jpeg.video.description repeats png-to-jpg's"],
  );
});

test("content has no video of its own: a Tool's video is its video field", () => {
  assert.deepEqual(
    validateCatalog([entry({ content: content({ videoSection: { embedId: "FJkyr2TEUs0" } }) })]),
    ["png-to-jpg.content.videoSection is not a known field"],
  );
});
