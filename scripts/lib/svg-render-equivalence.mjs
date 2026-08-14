export const SVG_RENDER_VIEWPORTS = Object.freeze([
  Object.freeze({ width: 320, height: 180 }),
  Object.freeze({ width: 640, height: 360 }),
]);

const MAX_CHANGED_PIXEL_RATIO = 0.0005;
const MAX_CHANNEL_DELTA = 4;
const MAX_MEAN_CHANNEL_DELTA = 0.01;

/**
 * Validates browser-derived DOM and decoded-pixel observations without sharing
 * the production SVG parser or optimizer implementation.
 */
export function assertSvgRenderEquivalence(summary) {
  if (
    !Number.isInteger(summary?.inputBytes) ||
    !Number.isInteger(summary?.outputBytes) ||
    summary.outputBytes > summary.inputBytes
  ) {
    throw new TypeError(
      'SVG compression must be smaller or honestly unchanged.',
    );
  }
  for (const [label, document] of [
    ['input', summary?.inputDocument],
    ['output', summary?.outputDocument],
  ]) {
    if (
      !document ||
      document.parseError ||
      document.rootName !== 'svg' ||
      document.namespace !== 'http://www.w3.org/2000/svg' ||
      document.width !== 320 ||
      document.height !== 180 ||
      document.viewBox !== '0 0 320 180' ||
      document.activeFindings?.length ||
      document.unresolvedFragmentRefs?.length
    ) {
      throw new TypeError(`${label} SVG DOM contract was not preserved.`);
    }
  }
  if (
    summary.inputDocument.referenceCount !==
    summary.outputDocument.referenceCount
  ) {
    throw new TypeError('SVG identifier-reference behavior changed.');
  }
  if (
    !Array.isArray(summary.renders) ||
    summary.renders.length !== SVG_RENDER_VIEWPORTS.length
  ) {
    throw new TypeError('SVG proof did not render both required viewports.');
  }
  summary.renders.forEach((render, index) => {
    const expected = SVG_RENDER_VIEWPORTS[index];
    if (
      render.width !== expected.width ||
      render.height !== expected.height ||
      render.inputNonTransparentPixels <= 0 ||
      render.outputNonTransparentPixels <= 0
    ) {
      throw new TypeError('SVG render was blank or used the wrong dimensions.');
    }
    const pixelCount = expected.width * expected.height;
    const changedRatio = render.changedPixels / pixelCount;
    const meanDelta = render.totalChannelDelta / (pixelCount * 4);
    if (
      changedRatio > MAX_CHANGED_PIXEL_RATIO ||
      render.maxChannelDelta > MAX_CHANNEL_DELTA ||
      meanDelta > MAX_MEAN_CHANNEL_DELTA
    ) {
      throw new TypeError(
        `SVG render changed (${changedRatio.toFixed(6)} pixels, max ${render.maxChannelDelta}, mean ${meanDelta.toFixed(6)}).`,
      );
    }
  });
  return Object.freeze({
    viewports: SVG_RENDER_VIEWPORTS.length,
    outputBytes: summary.outputBytes,
    inputBytes: summary.inputBytes,
    sizeOutcome:
      summary.outputBytes < summary.inputBytes ? 'smaller' : 'unchanged',
  });
}
