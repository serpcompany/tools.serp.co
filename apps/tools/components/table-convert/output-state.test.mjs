import test from "node:test";
import assert from "node:assert/strict";

import { canOfferOutput, nextUpload } from "./output-state.ts";

const tableA = { headers: ["name", "count"], rows: [["AAA_FIRST", "1"]] };
const tableB = { headers: ["name", "count"], rows: [["BBB_SECOND", "2"]] };

test("an upload is read, then parsed; a read that finishes after a newer upload is dropped", () => {
  let upload = nextUpload(null, { type: "start", name: "a.csv", ticket: 1 });
  upload = nextUpload(upload, { type: "start", name: "b.csv", ticket: 2 });
  // a.csv's read finishes late: b.csv is still the one being read.
  assert.deepEqual(nextUpload(upload, { type: "read", ticket: 1 }), { name: "b.csv", ticket: 2, read: false });
  // A parse of the text already on screen doesn't end b.csv's upload.
  assert.equal(nextUpload(upload, { type: "parsed" }), upload);
  upload = nextUpload(upload, { type: "read", ticket: 2 });
  assert.deepEqual(upload, { name: "b.csv", ticket: 2, read: true });
  assert.equal(nextUpload(upload, { type: "parsed" }), null);
});

test("typing or editing during a read cancels the upload", () => {
  const upload = nextUpload(null, { type: "start", name: "b.csv", ticket: 3 });
  assert.equal(nextUpload(upload, { type: "cancel" }), null);
  assert.equal(nextUpload(null, { type: "read", ticket: 3 }), null);
});

test("nothing is offered while a file is read, or while the input has an error", () => {
  const written = { table: tableA, format: "excel" };
  const page = { upload: null, error: null, table: tableA, outputFormat: "excel" };
  assert.equal(canOfferOutput(page, written), true);
  assert.equal(canOfferOutput({ ...page, upload: { name: "b.csv", ticket: 2, read: false } }, written), false);
  assert.equal(canOfferOutput({ ...page, upload: { name: "b.csv", ticket: 2, read: true } }, written), false);
  assert.equal(canOfferOutput({ ...page, error: "EXCEL input parsing is not wired yet." }, written), false);
  assert.equal(canOfferOutput({ ...page, table: null }, written), false);
  assert.equal(canOfferOutput(page, null), false);
});

test("an output written from the previous table or for another format isn't offered", () => {
  const page = { upload: null, error: null, table: tableB, outputFormat: "excel" };
  // The reviewer's case: b.csv is parsed, a.csv's workbook is still the one written.
  assert.equal(canOfferOutput(page, { table: tableA, format: "excel" }), false);
  // A table with the same cells is still another table until it's written.
  assert.equal(canOfferOutput(page, { table: structuredClone(tableB), format: "excel" }), false);
  assert.equal(canOfferOutput(page, { table: tableB, format: "pdf" }), false);
  assert.equal(canOfferOutput(page, { table: tableB, format: "excel" }), true);
});
