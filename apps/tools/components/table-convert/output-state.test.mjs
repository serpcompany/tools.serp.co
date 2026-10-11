import test from "node:test";
import assert from "node:assert/strict";

import { outputFileName } from "./formats.ts";
import { canOfferOutput, initialTablePage, offeredDownload, tablePageReducer } from "./output-state.ts";

// A small stand-in for convert.ts: text is `<format>:<cell>|<cell>…`, one
// column. Text in another format, with BROKEN in it, or empty doesn't parse,
// and Excel input can't be parsed or written, as on the page.
function parse(format, text) {
  if (!text.trim()) return { table: null, supported: true, error: "Paste or upload data to begin." };
  if (format === "excel") return { table: null, supported: false, error: "EXCEL input parsing is not wired yet." };
  if (!text.startsWith(`${format}:`)) return { table: null, supported: true, error: `This isn't ${format}.` };
  const body = text.slice(format.length + 1);
  if (body.includes("BROKEN")) return { table: null, supported: true, error: "Unclosed quote." };
  return { table: { headers: ["value"], rows: body.split("|").map((cell) => [cell]) }, supported: true };
}
function serialize(format, table) {
  if (format === "excel") return { text: "", supported: false };
  return { text: `${format}:${table.rows.map((row) => row[0]).join("|")}`, supported: true };
}
const placeholder = { headers: ["Column 1"], rows: [[""]] };
const next = tablePageReducer({ parse, serialize, placeholder });
const start = (format = "csv") => initialTablePage(format, placeholder);
const run = (state, ...events) => events.reduce(next, state);
const cells = (state) => state.table?.rows.map((row) => row[0]) ?? null;

// a.csv chosen and read.
function afterA() {
  return run(start(), { type: "upload", name: "a.csv", ticket: 1 }, { type: "read", ticket: 1, text: "csv:AAA_FIRST", format: "csv" });
}

test("a file's table and name arrive together; a read that finishes after a newer upload is dropped", () => {
  let state = run(start(), { type: "upload", name: "a.csv", ticket: 1 }, { type: "upload", name: "b.csv", ticket: 2 });
  // a.csv's read finishes late: b.csv is still being read, and nothing changes.
  assert.equal(next(state, { type: "read", ticket: 1, text: "csv:AAA_FIRST", format: "csv" }), state);
  state = next(state, { type: "read", ticket: 2, text: "csv:BBB_SECOND", format: "csv" });
  assert.deepEqual(cells(state), ["BBB_SECOND"]);
  assert.equal(state.fileName, "b.csv");
  assert.equal(state.upload, null);
});

test("typing, a grid edit or a clear during a read wins over it", () => {
  const a = afterA();
  const choosingB = next(a, { type: "upload", name: "b.csv", ticket: 2 });
  // While b.csv is read, a.csv's table and name stay (and nothing is offered).
  assert.equal(choosingB.fileName, "a.csv");
  const lateB = { type: "read", ticket: 2, text: "csv:BBB_SLOW", format: "csv" };
  // Typing over a.csv's table keeps a.csv's name; b.csv's late read is dropped.
  const typed = next(choosingB, { type: "type", text: "csv:TYPED" });
  assert.deepEqual([typed.fileName, typed.upload, cells(typed)], ["a.csv", null, ["TYPED"]]);
  assert.equal(next(typed, lateB), typed);
  const edited = next(choosingB, { type: "editGrid", table: { headers: ["value"], rows: [["EDITED"]] }, origin: a.origin });
  assert.deepEqual([edited.fileName, edited.upload, edited.inputText], ["a.csv", null, "csv:EDITED"]);
  assert.equal(next(edited, lateB), edited);
  const cleared = next(choosingB, { type: "clear" });
  assert.deepEqual([cleared.fileName, cleared.upload, cleared.table], [null, null, placeholder]);
  assert.equal(next(cleared, lateB), cleared);
});

test("a read or parse that fails clears the table and the name together", () => {
  const a = afterA();
  // b.csv couldn't be read: no table, no name, and the next edit has none.
  const unreadable = run(a, { type: "upload", name: "b.csv", ticket: 2 }, { type: "readFailed", ticket: 2, error: "b.csv couldn't be read" });
  assert.deepEqual([unreadable.table, unreadable.fileName, unreadable.error], [null, null, "b.csv couldn't be read"]);
  const typed = next(unreadable, { type: "type", text: "csv:AAA_FIRST|EDITED" });
  assert.deepEqual([cells(typed), typed.fileName], [["AAA_FIRST", "EDITED"], null]);
  // Typing that stops parsing drops the name too.
  const broken = next(a, { type: "type", text: "csv:AAA BROKEN" });
  assert.deepEqual([broken.table, broken.fileName], [null, null]);
  // A failed first upload leaves no name; the same file chosen again is read.
  const failedFirst = run(start(), { type: "upload", name: "b.csv", ticket: 1 }, { type: "readFailed", ticket: 1, error: "gone" });
  assert.equal(failedFirst.fileName, null);
  const retried = run(failedFirst, { type: "upload", name: "b.csv", ticket: 2 }, { type: "read", ticket: 2, text: "csv:BBB", format: "csv" });
  assert.deepEqual([retried.fileName, retried.error, cells(retried)], ["b.csv", null, ["BBB"]]);
  // Clearing drops the name.
  assert.equal(next(a, { type: "clear" }).fileName, null);
});

test("round 3: a grid edit after an upload that doesn't parse doesn't save the previous table under the new name", () => {
  const a = afterA();
  const b = run(a, { type: "upload", name: "b.json", ticket: 2 }, { type: "read", ticket: 2, text: 'json:{"name": "BBB_ BROKEN', format: "json" });
  assert.deepEqual([b.table, b.fileName, b.error], [null, null, "Unclosed quote."]);
  // The grid still showing a.csv's table reports a.csv's origin: dropped.
  const edit = { type: "editGrid", table: { headers: ["value"], rows: [["EDITED"]] }, origin: a.origin };
  assert.equal(next(b, edit), b);
  // b.json as the first upload: the placeholder's grid can't be edited into b.json either.
  const first = run(start("json"), { type: "upload", name: "b.json", ticket: 1 }, { type: "read", ticket: 1, text: "json:BROKEN", format: "json" });
  assert.equal(next(first, { ...edit, origin: 0 }), first);
  // A grid edit made on a.csv's table after b.csv replaced it is dropped too.
  const replaced = run(a, { type: "upload", name: "b.csv", ticket: 3 }, { type: "read", ticket: 3, text: "csv:BBB", format: "csv" });
  assert.equal(next(replaced, edit), replaced);
  assert.equal(next(replaced, { ...edit, origin: replaced.origin }).fileName, "b.csv");
});

test("round 2: an input the page can't read isn't rewritten from the previous table when the input format changes", () => {
  // a.csv, then b.xlsx: Excel input can't be read, so no table and no name.
  const b = run(afterA(), { type: "upload", name: "b.xlsx", ticket: 2 }, { type: "read", ticket: 2, text: "PK\u0003\u0004", format: "excel" });
  assert.deepEqual([b.table, b.fileName], [null, null]);
  // CSV picked: b.xlsx's text is parsed as CSV, never a.csv's table.
  const asCsv = next(b, { type: "inputFormat", format: "csv" });
  assert.deepEqual([asCsv.inputText, asCsv.table, asCsv.fileName], ["PK\u0003\u0004", null, null]);
  // b.xlsx holding CSV text parses once CSV is picked, and takes its name.
  const csvText = run(afterA(), { type: "upload", name: "b.xlsx", ticket: 2 }, { type: "read", ticket: 2, text: "csv:BBB_SECOND", format: "excel" });
  const picked = next(csvText, { type: "inputFormat", format: "csv" });
  assert.deepEqual([cells(picked), picked.fileName], [["BBB_SECOND"], "b.xlsx"]);
  // b.xlsx as the first upload: the placeholder isn't written into the input.
  const first = run(start(), { type: "upload", name: "b.xlsx", ticket: 1 }, { type: "read", ticket: 1, text: "PK", format: "excel" });
  const firstCsv = next(first, { type: "inputFormat", format: "csv" });
  assert.deepEqual([firstCsv.inputText, firstCsv.table, firstCsv.fileName], ["PK", null, null]);
  // A table on screen is rewritten in the new format and keeps its name.
  const json = next(afterA(), { type: "inputFormat", format: "json" });
  assert.deepEqual([json.inputText, cells(json), json.fileName], ["json:AAA_FIRST", ["AAA_FIRST"], "a.csv"]);
});

test("nothing is offered while a file is read, or while the input has an error", () => {
  const tableA = { headers: ["name"], rows: [["AAA_FIRST"]] };
  const written = { table: tableA, format: "excel" };
  const page = { upload: null, error: null, table: tableA, outputFormat: "excel" };
  assert.equal(canOfferOutput(page, written), true);
  assert.equal(canOfferOutput({ ...page, upload: { name: "b.csv", ticket: 2 } }, written), false);
  assert.equal(canOfferOutput({ ...page, error: "EXCEL input parsing is not wired yet." }, written), false);
  assert.equal(canOfferOutput({ ...page, table: null }, written), false);
  assert.equal(canOfferOutput(page, null), false);
});

test("an output written from the previous table or for another format isn't offered", () => {
  const tableA = { headers: ["name"], rows: [["AAA_FIRST"]] };
  const tableB = { headers: ["name"], rows: [["BBB_SECOND"]] };
  const page = { upload: null, error: null, table: tableB, outputFormat: "excel" };
  // The round-1 case: b.csv is parsed, a.csv's workbook is still the one written.
  assert.equal(canOfferOutput(page, { table: tableA, format: "excel" }), false);
  // A table with the same cells is still another table until it's written.
  assert.equal(canOfferOutput(page, { table: structuredClone(tableB), format: "excel" }), false);
  assert.equal(canOfferOutput(page, { table: tableB, format: "pdf" }), false);
  assert.equal(canOfferOutput(page, { table: tableB, format: "excel" }), true);
});

// Generated sequences. Each runs visitor actions and the page's asynchronous
// work in a random order: uploads that read, can't be read, don't parse or
// are in another format, finishing late and out of order; typing; grid edits
// from a grid that may still show an earlier table; input and output format
// switches; binary outputs that finish after the table changed; clears.
// After every step a reference model, kept here from the rules alone, says
// which file (if any) the table on screen came from, and the test checks
// the page's name, its table and whatever Download would save against it.
const SEQUENCES = 5000;
const STEPS = 40;
const SEED = 281249;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ACTIONS = [
  ["upload", 3], ["finish", 4], ["type", 3], ["editGrid", 4], ["syncGrid", 3],
  ["inputFormat", 2], ["outputFormat", 2], ["writeStart", 2], ["writeFinish", 2], ["clear", 1],
];
const INPUT_FORMATS = ["csv", "json", "excel"];
const OUTPUT_FORMATS = ["json", "csv", "excel", "pdf"];
const BINARY = new Set(["excel", "pdf"]);
const EXTENSIONS = { csv: "csv", json: "json", excel: "xlsx" };

function runSequence(rng, seen, log) {
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const weighted = () => {
    let roll = rng() * ACTIONS.reduce((sum, [, weight]) => sum + weight, 0);
    for (const [name, weight] of ACTIONS) if ((roll -= weight) < 0) return name;
    return ACTIONS[0][0];
  };
  let state = start(pick(INPUT_FORMATS));
  let outputFormat = pick(OUTPUT_FORMATS);
  let tickets = 0;
  let cellCount = 0;
  const reads = []; // uploads still being read, in any order
  const writes = []; // binary outputs being written
  let written = null; // the last binary output written

  // The reference model: which file the table on screen came from
  // (`lineage.name`), the upload still to be read, and the file whose text
  // is in the input untouched.
  let lineage = { name: null };
  let pending = null;
  let textFrom = null;
  // What the grid holds: the table it last synced, with that table's origin
  // and lineage; null once it's removed because there's no table.
  let grid = { table: state.table, origin: state.origin, lineage };

  for (let step = 0; step < STEPS; step += 1) {
    const action = weighted();
    let event = null;
    if (action === "upload") {
      const id = (tickets += 1);
      const detected = pick([...INPUT_FORMATS, null]);
      const textFormat = detected === "excel" ? pick(["csv", "json"]) : detected ?? pick(["csv", "json"]);
      const outcome = pick(["ok", "ok", "unparseable", "unreadable", "empty"]);
      const name = `f${id}.${detected ? EXTENSIONS[detected] : "txt"}`;
      const text = outcome === "empty" ? "" : `${textFormat}:F${id}a|F${id}b${outcome === "unparseable" ? " BROKEN" : ""}`;
      reads.push({ name, ticket: id, text, format: detected, outcome });
      event = { type: "upload", name, ticket: id };
    } else if (action === "finish") {
      if (!reads.length) continue;
      // Any read may finish next: a slow earlier one can finish last.
      const read = reads.splice(Math.floor(rng() * reads.length), 1)[0];
      event = read.outcome === "unreadable"
        ? { type: "readFailed", ticket: read.ticket, error: `${read.name} couldn't be read` }
        : { type: "read", ticket: read.ticket, text: read.text, format: read.format };
      event.file = read;
    } else if (action === "type") {
      cellCount += 1;
      const kind = pick(["append", "fresh", "broken", "other", "empty"]);
      const other = pick(INPUT_FORMATS.filter((format) => format !== state.inputFormat));
      const text = {
        append: `${state.inputText}|T${cellCount}`,
        fresh: `${state.inputFormat}:T${cellCount}`,
        broken: `${state.inputFormat}:T${cellCount} BROKEN`,
        other: `${other}:T${cellCount}`,
        empty: "",
      }[kind];
      event = { type: "type", text };
    } else if (action === "editGrid") {
      if (!grid) continue;
      cellCount += 1;
      event = { type: "editGrid", table: { headers: grid.table.headers, rows: [...grid.table.rows, [`G${cellCount}`]] }, origin: grid.origin };
    } else if (action === "syncGrid") {
      // The editor's effect: the grid takes the table on screen, or goes.
      grid = state.table ? { table: state.table, origin: state.origin, lineage } : null;
      continue;
    } else if (action === "inputFormat") {
      event = { type: "inputFormat", format: pick(INPUT_FORMATS.filter((format) => format !== state.inputFormat)) };
    } else if (action === "outputFormat") {
      outputFormat = pick(OUTPUT_FORMATS);
      log.push(`output ${outputFormat}`);
    } else if (action === "writeStart") {
      // As the page's effect: a binary output of the table on screen.
      if (BINARY.has(outputFormat) && state.table && state.hasUserInput && !state.error) {
        writes.push({ table: state.table, format: outputFormat, lineage });
        log.push("write start");
      }
    } else if (action === "writeFinish") {
      // Finishes even if the table changed since; the page's gate, not the
      // write's cancellation, must keep it from being offered.
      if (!writes.length) continue;
      written = writes.splice(Math.floor(rng() * writes.length), 1)[0];
      log.push(`write finish (${written.lineage?.name ?? "no file"})`);
    } else if (action === "clear") {
      event = { type: "clear" };
    }

    if (event) {
      const { file, ...pageEvent } = event;
      const before = state;
      log.push(JSON.stringify(pageEvent));
      state = next(before, pageEvent);
      const unchanged = () => assert.equal(state, before, "the event changes nothing");

      switch (event.type) {
        case "upload":
          assert.deepEqual([state.table, state.fileName, state.inputText], [before.table, before.fileName, before.inputText]);
          pending = event.ticket;
          break;
        case "read":
        case "readFailed": {
          if (pending !== event.ticket) {
            seen.droppedReads += 1;
            unchanged();
            break;
          }
          pending = null;
          if (event.type === "readFailed") {
            seen.unreadable += 1;
            lineage = null;
            break;
          }
          textFrom = file.name;
          const expected = parse(event.format ?? before.inputFormat, event.text).table;
          assert.deepEqual(state.table, expected, "a read file's table is its text, parsed");
          if (expected) seen.readOk += 1;
          else seen.readUnparseable += 1;
          lineage = expected ? { name: file.name } : null;
          break;
        }
        case "type":
          pending = null;
          textFrom = null;
          lineage = state.table ? lineage ?? { name: null } : null;
          break;
        case "editGrid": {
          // An edit applies only to the table on screen: same lineage as the
          // grid's, and there is a table.
          const applies = lineage !== null && grid.lineage === lineage;
          if (!applies) {
            if (!before.table) seen.editsWithoutTable += 1;
            else seen.staleEdits += 1;
            unchanged();
            break;
          }
          seen.edits += 1;
          assert.notEqual(state, before, "an edit of the table on screen applies");
          assert.equal(state.inputText, serialize(before.inputFormat, event.table).text);
          pending = null;
          textFrom = null;
          lineage = state.table ? lineage : null;
          break;
        }
        case "inputFormat":
          if (state.inputText !== before.inputText) textFrom = null;
          if (!state.table) lineage = null;
          else if (state.table !== before.table && !lineage) {
            lineage = { name: state.hasUserInput ? textFrom : null };
            if (lineage.name) seen.formatTakesFileName += 1;
          }
          break;
        case "clear":
          pending = null;
          textFrom = null;
          lineage = { name: null };
          break;
      }
    }

    // The name always belongs to the file the table on screen came from,
    // and there's no name without a table.
    assert.equal(state.table === null, lineage === null, "a table is on screen exactly when the model has one");
    assert.equal(state.fileName, lineage ? lineage.name : null, "the name is the file the table came from");
    if (state.error) assert.equal(state.table, null, "an error leaves no table");
    // The table on screen is the input parsed (or the placeholder, or a grid
    // edit in an input format the page can't write, Excel).
    if (state.table && state.hasUserInput && state.inputFormat !== "excel") {
      assert.deepEqual(state.table, parse(state.inputFormat, state.inputText).table, "the table is the input, parsed");
    }
    if (!state.hasUserInput && state.table) assert.equal(state.table, placeholder);

    // Download: a text output is serialized from the table as the page
    // renders; a binary one is whatever write finished last.
    const textOutput = state.table ? { table: state.table, format: outputFormat, lineage } : null;
    const offer = offeredDownload(state, outputFormat, BINARY.has(outputFormat) ? written : textOutput);
    if (state.upload) assert.equal(offer, null, "nothing is offered while a file is read");
    if (offer) {
      assert.ok(state.table && !state.error, "an offer needs a table on screen");
      assert.equal(offer.output.table, state.table, "the offer is of the table on screen");
      assert.equal(offer.output.format, outputFormat);
      assert.equal(offer.output.lineage, lineage, "the offer's bytes come from the table's file");
      assert.equal(offer.name, outputFileName(lineage.name, outputFormat), "the offer takes that file's name");
      if (lineage.name) seen.namedOffers += 1;
    }
  }
}

test(`the name and the offered download always describe the table on screen (${SEQUENCES} generated sequences of ${STEPS} steps)`, (t) => {
  const rng = mulberry32(SEED);
  const seen = {
    readOk: 0, readUnparseable: 0, unreadable: 0, droppedReads: 0, edits: 0, staleEdits: 0,
    editsWithoutTable: 0, formatTakesFileName: 0, namedOffers: 0,
  };
  for (let sequence = 0; sequence < SEQUENCES; sequence += 1) {
    const log = [];
    try {
      runSequence(rng, seen, log);
    } catch (error) {
      error.message = `sequence ${sequence} (seed ${SEED}): ${error.message}\n  ${log.join("\n  ")}`;
      throw error;
    }
  }
  // The sequences reach every case the reviews found, many times over.
  t.diagnostic(`cases reached: ${JSON.stringify(seen)}`);
  for (const [name, count] of Object.entries(seen)) assert.ok(count >= 100, `${name} reached only ${count} times`);
});
