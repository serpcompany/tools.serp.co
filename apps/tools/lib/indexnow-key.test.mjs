import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// Once auto-submission is on (#314 H4), the Ahrefs Site Audit project submits
// changed tools.serp.co pages to IndexNow with this key, and the engines check
// it at /<key>.txt. Renaming, removing or editing the file stops submissions
// until Ahrefs has the new key. The Deploy smoke (scripts/smoke-cloudflare-api.mjs)
// checks the served URL.
const publicDir = new URL("../public/", import.meta.url);
const KEY_FILE = /^[0-9a-f]{32}\.txt$/;

test("public/ holds one IndexNow key file, and its body is exactly its name", () => {
  const keyFiles = readdirSync(publicDir).filter((name) => KEY_FILE.test(name));
  assert.equal(keyFiles.length, 1, `expected one key file, found ${keyFiles.join(", ") || "none"}`);
  const [file] = keyFiles;
  assert.equal(readFileSync(new URL(file, publicDir), "utf8"), file.slice(0, -".txt".length));
});
