import test from "node:test";
import assert from "node:assert/strict";

import { parseCsvTable } from "./table-data.ts";

test("a one-column CSV is read as one column, not refused for having no delimiter", () => {
  assert.deepEqual(parseCsvTable("name\nAlpha\nBeta\n"), {
    table: { headers: ["name"], rows: [["Alpha"], ["Beta"]] },
    error: null,
  });
  // A quoted comma is part of the one cell.
  assert.deepEqual(parseCsvTable('name\n"Smith, Jo"\n"say ""hi"""\n'), {
    table: { headers: ["name"], rows: [["Smith, Jo"], ['say "hi"']] },
    error: null,
  });
  assert.deepEqual(parseCsvTable("only a header\n").table, { headers: ["only a header"], rows: [] });
});

test("CSV delimiters are still guessed, and broken CSV is still refused", () => {
  assert.deepEqual(parseCsvTable("a;b\n1;2\n").table, { headers: ["a", "b"], rows: [["1", "2"]] });
  assert.deepEqual(parseCsvTable("a\tb\n1\t2\n").table, { headers: ["a", "b"], rows: [["1", "2"]] });
  const unclosed = parseCsvTable('name,count\n"Alpha,1\n');
  assert.equal(unclosed.table, null);
  assert.match(unclosed.error, /quote/i);
  assert.deepEqual(parseCsvTable(""), { table: null, error: "CSV is empty." });
});
