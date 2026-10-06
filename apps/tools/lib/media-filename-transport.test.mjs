import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  readMediaFilename,
  setMediaFilenameHeaders,
} from "./media-filename-transport.ts";

function isPrintableAscii(value) {
  return Array.from(value).every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 0x20 && codePoint <= 0x7e;
  });
}

test("a raw non-Latin-1 filename cannot be set as a header value", () => {
  assert.throws(() => new Headers().set("x-media-filename", "Ru-Москва.ogg"), TypeError);
});

test("Unicode filenames survive the header round trip byte-for-byte", () => {
  for (const name of ["Fr-café.ogg", "Ru-Москва.ogg", "東京 — café 🎵.mp3"]) {
    const headers = new Headers();
    assert.doesNotThrow(() => setMediaFilenameHeaders(headers, name));
    assert.ok(isPrintableAscii(headers.get("x-media-filename")));
    assert.ok(isPrintableAscii(headers.get("x-media-filename-encoded")));
    assert.equal(readMediaFilename(headers), name);
    assert.doesNotThrow(() => new Response(null, { headers }));
  }
});

test("the encoded header follows RFC 5987 percent-encoding", () => {
  const headers = new Headers();
  setMediaFilenameHeaders(headers, "Fr-café (live)'s!.ogg");

  assert.equal(
    headers.get("x-media-filename-encoded"),
    "Fr-caf%C3%A9%20%28live%29%27s%21.ogg",
  );
  assert.equal(headers.get("x-media-filename"), "Fr-caf- (live)'s!.ogg");
});

test("ASCII filenames are unchanged in the legacy header", () => {
  const headers = new Headers();
  setMediaFilenameHeaders(headers, "Episode 1 (final).mp3");

  assert.equal(headers.get("x-media-filename"), "Episode 1 (final).mp3");
  assert.equal(readMediaFilename(headers), "Episode 1 (final).mp3");
});

test("path separators and control characters are removed", () => {
  const headers = new Headers();
  setMediaFilenameHeaders(headers, "family/../東京\\track\r\n\u0000.mp3");

  assert.equal(readMediaFilename(headers), "family-..-東京-track.mp3");
});

test("very long names are bounded and keep their extension", () => {
  const headers = new Headers();
  setMediaFilenameHeaders(headers, `${"🎵".repeat(1_000)}.mp3`);

  const name = readMediaFilename(headers);
  assert.ok(Array.from(name).length <= 180);
  assert.match(name, /\.mp3$/u);
  assert.ok(headers.get("x-media-filename").length <= 180);
});

test("readers fall back to the ASCII header when the encoded one is missing or malformed", () => {
  assert.equal(
    readMediaFilename(new Headers({ "x-media-filename": "fallback.mp3" })),
    "fallback.mp3",
  );
  assert.equal(
    readMediaFilename(
      new Headers({
        "x-media-filename": "fallback.mp3",
        "x-media-filename-encoded": "%E0%A4%A",
      }),
    ),
    "fallback.mp3",
  );
  assert.equal(readMediaFilename(new Headers()), "");
});

test("media-fetch and its clients use the transport instead of the raw header", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const route = read("../app/api/media-fetch/route.ts");
  assert.match(route, /setMediaFilenameHeaders\(headers, args\.fileName\)/);
  assert.doesNotMatch(route, /headers\.set\("x-media-filename"/);

  for (const component of [
    "../components/TranscribeTool.tsx",
    "../components/VideoDownloaderTool.tsx",
  ]) {
    const source = read(component);
    assert.match(source, /readMediaFilename\(response\.headers\)/);
    assert.doesNotMatch(source, /headers\.get\("x-media-filename"\)/);
  }
});
