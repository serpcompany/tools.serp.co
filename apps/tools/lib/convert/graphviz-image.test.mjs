import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GRAPH_SCALE,
  LARGE_GRAPH_EDGES,
  LAYOUT_TIMEOUT_MS,
  MAX_DOT_BYTES,
  countEdges,
  graphScaleNotice,
  graphWarningsNotice,
  layoutGraph,
} from "./graphviz-image.ts";
import { prepareSvgForImage, svgImageSize, svgSize } from "./svg-image.ts";
import { REMOVED_DEVICES, layOutGraph, removeDevices } from "./graphviz.worker.ts";
import { threadCpuMs } from "./test-cpu-time.mjs";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../benchmarks/fixtures");

// The worker's answer, laid out here with Viz.js in Node.
const layOut = (dot, graphAttributes) => layOutGraph({ dot, graphAttributes });

test("edges are counted by their operators", () => {
  assert.equal(countEdges("digraph { a -> b -> c; d }"), 2);
  assert.equal(countEdges("graph { a -- b }"), 1);
  assert.ok(LARGE_GRAPH_EDGES >= 1000);
  assert.equal(MAX_DOT_BYTES, 2 * 1024 * 1024);
  assert.equal(LAYOUT_TIMEOUT_MS, 60_000);
});

test("a graph is drawn at 2 px a point, or smaller to fit 4096 px, and says so", () => {
  const small = svgImageSize(62, 116, GRAPH_SCALE);
  assert.deepEqual(small, { width: 124, height: 232, scale: GRAPH_SCALE });
  assert.equal(graphScaleNotice({ width: 62, height: 116 }, small), undefined);
  const wide = svgImageSize(40_045, 1_124, GRAPH_SCALE);
  assert.match(graphScaleNotice({ width: 40_045, height: 1_124 }, wide), /^The graph is 40,045 x 1,124 pt, so it's drawn smaller to fit a 4,096 px image \(4,096 x 115 px\)/);
});

test("the sample graph lays out in the worker", async () => {
  const reply = await layOut(readFileSync(path.join(fixtures, "sample.dot"), "utf8"));
  assert.equal(reply.ok, true);
  assert.ok(svgSize(reply.svg).width > 0);
  assert.match(reply.svg, /<g id="node1" class="node">/);
});

test("a DOT file that names files and URLs draws without them, and says so", async () => {
  const reply = await layOut(readFileSync(path.join(fixtures, "hostile-graph.dot"), "utf8"));
  assert.equal(reply.ok, true);
  const prepared = prepareSvgForImage(reply.svg, 100, 100);
  assert.ok(!/<image\b/.test(prepared), "an image element survived");
  assert.ok(!/xml-stylesheet/.test(prepared), "a stylesheet link survived");
  assert.ok(!prepared.includes("root:"), "a file's contents were read into the graph");
  assert.equal(graphWarningsNotice(reply.warnings), "Pictures and shape files the graph names aren't drawn: only the DOT file itself is uploaded.");
});

test("a syntax error is the worker's error", async () => {
  const reply = await layOut("digraph { a -> }");
  assert.equal(reply.ok, false);
  assert.match(reply.error, /syntax error in line 1/);
});

test("the file's own settings win over the defaults a large graph gets", async () => {
  const reply = await layOut('digraph { label="mine"; a -> b }', { label: "default" });
  assert.match(reply.svg, /mine/);
  assert.doesNotMatch(reply.svg, /default/);
});

test("a layout that runs past its time is stopped, and its worker terminated", async () => {
  const worker = { terminated: false, posted: null, onmessage: null, onerror: null };
  worker.postMessage = (job) => (worker.posted = job);
  worker.terminate = () => (worker.terminated = true);
  // The worker never answers, as Graphviz reading an endless shape file.
  await assert.rejects(layoutGraph({ dot: "digraph { a }" }, { timeoutMs: 20, createWorker: () => worker }), (error) => {
    assert.equal(error.code, "layout_timeout");
    assert.match(error.message, /took more than 60 seconds to lay out in the browser, so it was stopped/);
    return true;
  });
  assert.equal(worker.terminated, true);
  assert.deepEqual(worker.posted, { dot: "digraph { a }" });
});

test("a worker that answers or fails is terminated too", async () => {
  const make = () => {
    const worker = { terminated: false, onmessage: null, onerror: null, terminate: () => (worker.terminated = true) };
    return worker;
  };
  const answering = make();
  answering.postMessage = () => setTimeout(() => answering.onmessage({ data: { ok: false, error: "syntax error in line 1" } }));
  await assert.rejects(layoutGraph({ dot: "x" }, { createWorker: () => answering }), /couldn't be laid out \(syntax error in line 1\)/);
  assert.equal(answering.terminated, true);
  const crashing = make();
  crashing.postMessage = () => setTimeout(() => crashing.onerror({ message: "" }));
  await assert.rejects(layoutGraph({ dot: "x" }, { createWorker: () => crashing }), /out of memory/);
  assert.equal(crashing.terminated, true);
});

test("a shape file read from an endless device ends at once: the worker removes those devices", async () => {
  const started = threadCpuMs();
  const reply = await layOut(
    'digraph { a [shape=epsf, shapefile="/dev/urandom"]; b [shape=epsf, shapefile="/dev/random"]; c [image="/dev/tty"]; d [shape=epsf, shapefile="/dev/stdin"]; e [shape=epsf, shapefile="/proc/self/fd/0"] }',
  );
  assert.ok(threadCpuMs() - started < 5000, `took ${threadCpuMs() - started} ms`);
  assert.equal(reply.ok, true);
  assert.ok(reply.warnings.includes("couldn't open epsf file /dev/urandom"), reply.warnings.join("; "));
});

test("devices are removed only where Viz.js exposes its file system", () => {
  const removed = [];
  assert.deepEqual(removeDevices({ module: { FS: { unlink: (path) => removed.push(path) } } }), REMOVED_DEVICES);
  assert.deepEqual(removed, REMOVED_DEVICES);
  assert.deepEqual(removeDevices({}), []);
  assert.deepEqual(removeDevices({ module: { FS: { unlink: () => { throw new Error("gone"); } } } }), []);
});
