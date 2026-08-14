import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSvgRenderEquivalence,
  SVG_RENDER_VIEWPORTS,
} from './svg-render-equivalence.mjs';

const document = () => ({
  parseError: null,
  rootName: 'svg',
  namespace: 'http://www.w3.org/2000/svg',
  width: 320,
  height: 180,
  viewBox: '0 0 320 180',
  activeFindings: [],
  unresolvedFragmentRefs: [],
  referenceCount: 5,
});

const valid = () => ({
  inputBytes: 993,
  outputBytes: 700,
  inputDocument: document(),
  outputDocument: document(),
  renders: SVG_RENDER_VIEWPORTS.map(({ width, height }) => ({
    width,
    height,
    inputNonTransparentPixels: width * height,
    outputNonTransparentPixels: width * height,
    changedPixels: 0,
    maxChannelDelta: 0,
    totalChannelDelta: 0,
  })),
});

test('accepts independently decoded equivalent nonblank SVG renders', () => {
  assert.deepEqual(assertSvgRenderEquivalence(valid()), {
    viewports: 2,
    inputBytes: 993,
    outputBytes: 700,
    sizeOutcome: 'smaller',
  });
});

test('rejects malformed, active, unresolved, blank, wrong-sized, and changed SVGs', () => {
  const mutations = [
    (value) => (value.outputDocument.parseError = 'bad XML'),
    (value) => value.outputDocument.activeFindings.push('script'),
    (value) => value.outputDocument.unresolvedFragmentRefs.push('#missing'),
    (value) => (value.outputDocument.referenceCount = 4),
    (value) => (value.renders[0].outputNonTransparentPixels = 0),
    (value) => (value.renders[0].width = 319),
    (value) => (value.outputBytes = value.inputBytes + 1),
    (value) => {
      value.renders[0].changedPixels = 1_000;
      value.renders[0].maxChannelDelta = 255;
      value.renders[0].totalChannelDelta = 255_000;
    },
  ];
  for (const mutate of mutations) {
    const value = valid();
    mutate(value);
    assert.throws(() => assertSvgRenderEquivalence(value));
  }
});
