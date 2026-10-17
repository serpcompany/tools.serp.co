import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GONE_ROUTES_MODULE,
  goneRoutesModuleSource,
  goneToolRoutes,
  readGoneToolRoutes,
} from "../scripts/lib/gone-tool-routes.mjs";
import { toolHref } from "./catalog/href.ts";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

const tool = (id, isActive, { operation = "convert", route = `/${id}` } = {}) => ({ id, isActive, operation, route });
const keyword = (text, global_volume, operation = "convert") => ({ keyword: text, global_volume, operation });

test("retired Tools without exact keyword demand are gone; demand, live routes and rebuilt Tools are not", () => {
  const tools = [
    tool("avi-to-rmvb", false),
    tool("html-to-mp3", false),
    tool("compress-heic", false, { operation: "compress" }),
    tool("compress-tiff", false, { operation: "compress" }),
    tool("jpeg-to-dxf", false),
    tool("cr3-to-cr3", false),
    tool("mp4-to-mp3", true),
    // Retired under one id while an active Tool serves the same route.
    tool("png-to-png", false, { route: "/compress-png" }),
    tool("compress-png", true, { operation: "compress" }),
  ];
  const keywords = [
    keyword("html to mp3", 800),
    keyword("tiff compressor", 90, "compress"),
    // An alias keyword ("jpg", not "jpeg") is not demand for jpeg-to-dxf.
    keyword("jpg to dxf", 5400),
    // A known zero and an unknown volume are no demand.
    keyword("cr3 to cr3", 0),
    keyword("avi to rmvb", null),
    keyword("mp4 to mp3", 934000),
  ];
  assert.deepEqual(goneToolRoutes({ tools, keywords }), [
    "/avi-to-rmvb/",
    "/compress-heic/",
    "/cr3-to-cr3/",
    "/jpeg-to-dxf/",
  ]);

  // Rebuilt: made active again, it leaves the list with nothing else edited.
  const rebuilt = tools.map((entry) => (entry.id === "avi-to-rmvb" ? { ...entry, isActive: true } : entry));
  assert.ok(!goneToolRoutes({ tools: rebuilt, keywords }).includes("/avi-to-rmvb/"));
});

test("only a retired Tool of an operation keywords.csv researched can be gone", () => {
  const tools = [
    tool("download-tellatv-videos", false, { operation: "download" }),
    tool("pdf-editor", false, { operation: "edit" }),
    tool("webm-to-flac", false),
    tool("html-to-mp3", false),
  ];
  const keywords = [keyword("html to mp3", 800), keyword("mp4 to mp3", 934000)];
  // A retired downloader Lander or editor with no keyword row keeps its 404;
  // a retired converter with no row is gone, and one with demand isn't.
  assert.deepEqual(goneToolRoutes({ tools, keywords }), ["/webm-to-flac/"]);

  // The researched operations come from the keyword rows, not a fixed list:
  // once download keywords are researched, a Lander with none is gone too.
  const withDownloads = [...keywords, keyword("download loom videos", 1200, "download")];
  assert.deepEqual(goneToolRoutes({ tools, keywords: withDownloads }), [
    "/download-tellatv-videos/",
    "/webm-to-flac/",
  ]);
  // With no keyword data at all, nothing is gone.
  assert.deepEqual(goneToolRoutes({ tools, keywords: [] }), []);
});

test("this checkout's gone list holds only retired Tool routes that no page or live Tool serves", () => {
  const tools = JSON.parse(readFileSync(new URL("./catalog/tools.json", import.meta.url), "utf8"));
  const routes = readGoneToolRoutes(appRoot);
  const retired = new Set(tools.filter((entry) => !entry.isActive).map(toolHref));
  const live = new Set(tools.filter((entry) => entry.isActive).map(toolHref));
  // The path of each folder under app/ that renders a page of its own, such
  // as a table converter's, with route groups like (convert) dropped. A
  // retired Tool on the list has its folder deleted in the same change
  // (docs/tool-catalog.md "Retiring a Tool").
  const pageFolders = new Set(
    readdirSync(new URL("../app", import.meta.url), { recursive: true })
      .map((file) => file.split(path.sep))
      .filter((parts) => parts.at(-1) === "page.tsx")
      .map((parts) => `/${parts.slice(0, -1).filter((part) => !/^\(.*\)$/.test(part)).join("/")}/`),
  );
  assert.ok(pageFolders.has("/audio-to-text/") && pageFolders.has("/[tool]/"));

  assert.ok(routes.length > 0);
  for (const route of routes) {
    assert.ok(retired.has(route), `${route} is a retired Tool's route`);
    assert.ok(!live.has(route), `${route} is not a live Tool's route`);
    assert.ok(!pageFolders.has(route), `${route} has no page folder under app/`);
  }
});

test("the generated module exports the routes and is never committed", async () => {
  const routes = ["/avi-to-rmvb/", "/compress-heic/"];
  const source = goneRoutesModuleSource(routes);
  const imported = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  assert.deepEqual(imported.default, routes);

  const gitignore = readFileSync(new URL("../../../.gitignore", import.meta.url), "utf8");
  assert.ok(gitignore.split("\n").includes(`apps/tools/${GONE_ROUTES_MODULE}`));
});
