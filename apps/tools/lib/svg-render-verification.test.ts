import assert from 'node:assert/strict';
import test from 'node:test';

import { verifySvgRenderEquivalence } from './svg-render-verification.ts';

const bytes = (length: number) => new Uint8Array(length);
const identity = {
  width: 320,
  height: 180,
  viewBox: '0 0 320 180',
  referenceCount: 5,
};
const pixels = (value = 20) =>
  new Uint8ClampedArray([value, value, value, 255]);

test('production SVG semantic seam accepts two equivalent nonblank viewport renders', async () => {
  let renders = 0;
  const result = await verifySvgRenderEquivalence({
    input: bytes(20),
    output: bytes(10),
    signal: new AbortController().signal,
    ports: {
      inspect: () => identity,
      async rasterize() {
        renders += 1;
        return pixels();
      },
    },
  });
  assert.deepEqual(result, { status: 'verified' });
  assert.equal(renders, 4);
});

test('production SVG semantic seam rejects larger, changed, blank, and wrong-dimension output', async () => {
  const cases = [
    {
      input: bytes(10),
      output: bytes(11),
      inspect: () => identity,
      rasterize: async () => pixels(),
    },
    {
      input: bytes(20),
      output: bytes(10),
      inspect: (() => {
        let call = 0;
        return () => ({ ...identity, width: call++ === 0 ? 320 : 319 });
      })(),
      rasterize: async () => pixels(),
    },
    {
      input: bytes(20),
      output: bytes(10),
      inspect: (() => {
        let call = 0;
        return () => ({
          ...identity,
          referenceCount: call++ === 0 ? 5 : 4,
        });
      })(),
      rasterize: async () => pixels(),
    },
    {
      input: bytes(20),
      output: bytes(10),
      inspect: () => identity,
      rasterize: (() => {
        let call = 0;
        return async () => pixels(call++ % 2 === 0 ? 20 : 255);
      })(),
    },
    {
      input: bytes(20),
      output: bytes(10),
      inspect: () => identity,
      rasterize: async () => new Uint8ClampedArray([0, 0, 0, 0]),
    },
  ];
  for (const value of cases) {
    const result = await verifySvgRenderEquivalence({
      input: value.input,
      output: value.output,
      signal: new AbortController().signal,
      ports: { inspect: value.inspect, rasterize: value.rasterize },
    });
    assert.equal(result.status, 'rejected');
  }
});

test('SVG verification cancellation rejects without accepting late raster output', async () => {
  const controller = new AbortController();
  let entered = false;
  const pending = verifySvgRenderEquivalence({
    input: bytes(20),
    output: bytes(10),
    signal: controller.signal,
    ports: {
      inspect: () => identity,
      async rasterize(_bytes, _viewport, signal) {
        entered = true;
        return await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
      },
    },
  });
  while (!entered) await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  await assert.rejects(pending, { name: 'AbortError' });
});
