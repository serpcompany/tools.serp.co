import test from "node:test";
import assert from "node:assert/strict";

import {
  compressFile,
  compressPngWithWorker,
  convertWithWorker,
} from "./workerClient.ts";
import { resolveAdaptiveVideoExecution } from "./workerClient.ts";

function makeBuffer(size) {
  return new Uint8Array(size).buffer;
}

test("compressFile uses server image compression for gif", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (input, init) => {
    calls.push({ input, init });
    const output = makeBuffer(3);
    return new Response(output, { status: 200 });
  };

  try {
    const result = await compressFile({
      format: "gif",
      buf: makeBuffer(10),
      quality: 0.8,
    });
    assert.equal(result.byteLength, 3);
    assert.equal(calls.length, 1);
    const url =
      typeof calls[0].input === "string" ? calls[0].input : calls[0].input.url;
    assert.ok(url.includes("/api/image-compress"));
    assert.ok(url.includes("format=gif"));
    assert.equal(calls[0].init?.method, "POST");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("compressFile returns original buffer when server result is larger", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    const output = makeBuffer(20);
    return new Response(output, { status: 200 });
  };

  const original = makeBuffer(10);
  try {
    const result = await compressFile({
      format: "gif",
      buf: original,
      quality: 0.8,
    });
    assert.equal(result, original);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("server processing receives the caller signal and aborts the request", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let receivedSignal;
  globalThis.fetch = async (_input, init) => {
    receivedSignal = init?.signal;
    return await new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal.reason), {
        once: true,
      });
    });
  };
  try {
    const pending = compressFile({
      format: "gif",
      buf: makeBuffer(10),
      quality: 0.8,
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(pending);
    assert.equal(receivedSignal, controller.signal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("worker processing terminates promptly when the caller aborts", async () => {
  const controller = new AbortController();
  let terminated = false;
  const worker = {
    onmessage: null,
    onerror: null,
    postMessage() {},
    terminate() {
      terminated = true;
    },
  };
  const pending = convertWithWorker({
    worker,
    from: "png",
    to: "jpg",
    buf: makeBuffer(10),
    signal: controller.signal,
  });
  controller.abort();

  await assert.rejects(pending, /abort/i);
  assert.equal(terminated, true);
});

test("batch PNG worker failure fails closed instead of entering a synchronous fallback", async () => {
  const worker = {
    onmessage: null,
    onerror: null,
    postMessage() {
      queueMicrotask(() => this.onerror?.({ message: "worker unavailable" }));
    },
    terminate() {},
  };
  await assert.rejects(
    compressPngWithWorker({
      worker,
      buf: makeBuffer(10),
      fallback: "fail-closed",
    }),
    /worker unavailable/,
  );
});

test("batch PNG fail-closed worker cancellation terminates promptly", async () => {
  const controller = new AbortController();
  let terminated = false;
  const worker = {
    onmessage: null,
    onerror: null,
    postMessage() {},
    terminate() {
      terminated = true;
    },
  };
  const pending = compressPngWithWorker({
    worker,
    buf: makeBuffer(10),
    signal: controller.signal,
    fallback: "fail-closed",
  });
  controller.abort();

  await assert.rejects(pending, /abort/i);
  assert.equal(terminated, true);
});

test("adaptive media execution truthfully retains both fallback directions", () => {
  assert.deepEqual(
    resolveAdaptiveVideoExecution({ preferServer: true, canUseClient: true }),
    ["server", "browser"],
  );
  assert.deepEqual(
    resolveAdaptiveVideoExecution({ preferServer: false, canUseClient: true }),
    ["browser", "server"],
  );
  assert.deepEqual(
    resolveAdaptiveVideoExecution({ preferServer: false, canUseClient: false }),
    ["server"],
  );
});
