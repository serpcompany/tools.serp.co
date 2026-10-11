import test from "node:test";
import assert from "node:assert/strict";

import { NO_UPLOAD, canOfferOutput, nextUpload, rewritesInputOnFormatChange } from "./output-state.ts";

const tableA = { headers: ["name", "count"], rows: [["AAA_FIRST", "1"]] };
const tableB = { headers: ["name", "count"], rows: [["BBB_SECOND", "2"]] };
const placeholder = { headers: ["Column 1"], rows: [[""]] };

// a.csv chosen and accepted: its name is the one downloads take.
function afterA() {
  let state = nextUpload(NO_UPLOAD, { type: "start", name: "a.csv", ticket: 1 });
  state = nextUpload(state, { type: "read", ticket: 1 });
  return nextUpload(state, { type: "parsed" });
}

test("an upload is read, then parsed; a read that finishes after a newer upload is dropped", () => {
  let state = nextUpload(NO_UPLOAD, { type: "start", name: "a.csv", ticket: 1 });
  state = nextUpload(state, { type: "start", name: "b.csv", ticket: 2 });
  // a.csv's read finishes late: b.csv is still the one being read, and
  // neither name is taken yet.
  assert.deepEqual(nextUpload(state, { type: "read", ticket: 1 }), {
    fileName: null,
    upload: { name: "b.csv", ticket: 2, read: false },
  });
  // A parse of the text already on screen doesn't end b.csv's upload.
  assert.equal(nextUpload(state, { type: "parsed" }), state);
  state = nextUpload(state, { type: "read", ticket: 2 });
  assert.deepEqual(state, { fileName: "b.csv", upload: { name: "b.csv", ticket: 2, read: true } });
  assert.deepEqual(nextUpload(state, { type: "parsed" }), { fileName: "b.csv", upload: null });
});

test("typing or editing during a read cancels the upload", () => {
  const state = nextUpload(NO_UPLOAD, { type: "start", name: "b.csv", ticket: 3 });
  assert.deepEqual(nextUpload(state, { type: "cancel" }), NO_UPLOAD);
  assert.equal(nextUpload(NO_UPLOAD, { type: "read", ticket: 3 }), NO_UPLOAD);
});

test("a file's name is taken only once its text is accepted", () => {
  const a = afterA();
  assert.deepEqual(a, { fileName: "a.csv", upload: null });
  const choosingB = nextUpload(a, { type: "start", name: "b.csv", ticket: 2 });
  // While b.csv is read, downloads would still be a.csv's (none are offered).
  assert.equal(choosingB.fileName, "a.csv");
  // Typing before b.csv is read: the typed-over a.csv table keeps a.csv's
  // name, and b.csv's late read (dropped by its ticket) doesn't take it.
  const typed = nextUpload(choosingB, { type: "cancel" });
  assert.deepEqual(typed, { fileName: "a.csv", upload: null });
  assert.equal(nextUpload(typed, { type: "read", ticket: 2 }), typed);
  // b.csv couldn't be read: the next edit offers a.csv's table as a.csv's.
  assert.deepEqual(nextUpload(choosingB, { type: "cancel" }), { fileName: "a.csv", upload: null });
  // A failed first upload leaves no name (pasted text saves as table.<ext>).
  const failedFirst = nextUpload(nextUpload(NO_UPLOAD, { type: "start", name: "b.csv", ticket: 1 }), { type: "cancel" });
  assert.deepEqual(failedFirst, NO_UPLOAD);
  // Choosing the same file again reads it again and takes its name.
  let retry = nextUpload(failedFirst, { type: "start", name: "b.csv", ticket: 2 });
  retry = nextUpload(retry, { type: "read", ticket: 2 });
  assert.equal(retry.fileName, "b.csv");
  // Clearing drops the name.
  assert.deepEqual(nextUpload(a, { type: "clear" }), NO_UPLOAD);
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

test("an input the page can't read isn't rewritten from the previous table when the input format changes", () => {
  const unreadable = "EXCEL input parsing is not wired yet.";
  // a.csv, then b.xlsx: the table is still a.csv's, under b.xlsx's error.
  assert.equal(rewritesInputOnFormatChange({ table: tableA, hasUserInput: true, error: unreadable }), false);
  // b.xlsx as the first upload: the table is the placeholder.
  assert.equal(rewritesInputOnFormatChange({ table: placeholder, hasUserInput: true, error: unreadable }), false);
  // A read that failed leaves the previous table too.
  assert.equal(rewritesInputOnFormatChange({ table: tableA, hasUserInput: true, error: "b.csv couldn't be read: gone" }), false);
  // The placeholder before any input, and no table at all.
  assert.equal(rewritesInputOnFormatChange({ table: placeholder, hasUserInput: false, error: null }), false);
  assert.equal(rewritesInputOnFormatChange({ table: null, hasUserInput: true, error: null }), false);
  // A table parsed from the input on screen is rewritten in the new format.
  assert.equal(rewritesInputOnFormatChange({ table: tableA, hasUserInput: true, error: null }), true);
});
