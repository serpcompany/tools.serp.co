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

test("ids and routes are unique", () => {
  assert.deepEqual(
    validateCatalog([entry(), entry({ route: "/png-to-jpeg" }), entry({ id: "png-to-jpeg" })]),
    ["png-to-jpg: duplicate id", "png-to-jpeg: duplicate route /png-to-jpg"],
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
