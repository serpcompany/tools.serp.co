import fs from 'node:fs/promises';
import path from 'node:path';

import { assertExactFixtureBytes } from './golden-output-semantics.mjs';
import {
  assertSvgRenderEquivalence,
  SVG_RENDER_VIEWPORTS,
} from './svg-render-equivalence.mjs';

function assertDedicatedWorker(workerUrls, pageUrl, label) {
  const workerUrl = workerUrls[0] ? new URL(workerUrls[0], pageUrl) : null;
  if (
    workerUrls.length !== 1 ||
    workerUrl?.origin !== new URL(pageUrl).origin ||
    !workerUrl.pathname.includes('/_next/static/chunks/') ||
    !workerUrl.pathname.endsWith('.js')
  ) {
    throw new Error(
      `${label} did not load one dedicated Worker (${workerUrls.join(', ')}).`,
    );
  }
  return workerUrl.href;
}

async function inspectSvgRenderEquivalence(page, inputBytes, outputBytes) {
  return page.evaluate(
    async ({ input, output, viewports }) => {
      const decodeText = (bytes) =>
        new TextDecoder('utf-8', { fatal: true }).decode(
          Uint8Array.from(bytes),
        );
      const inspectDocument = (source) => {
        const document = new DOMParser().parseFromString(
          source,
          'image/svg+xml',
        );
        const root = document.documentElement;
        const parseError = document.querySelector('parsererror')?.textContent;
        const activeElements = new Set([
          'animate',
          'animatemotion',
          'animatetransform',
          'audio',
          'embed',
          'foreignobject',
          'iframe',
          'object',
          'script',
          'set',
          'style',
          'video',
        ]);
        const activeFindings = [];
        const unresolvedFragmentRefs = [];
        let referenceCount = 0;
        const ids = new Set(
          [...document.querySelectorAll('[id]')]
            .map((element) => element.id)
            .filter(Boolean),
        );
        for (const element of document.querySelectorAll('*')) {
          if (activeElements.has(element.localName.toLowerCase())) {
            activeFindings.push(element.localName);
          }
          for (const attribute of element.attributes) {
            const name = attribute.name.toLowerCase();
            const value = attribute.value.trim();
            if (name.startsWith('on') || name === 'xml:base') {
              activeFindings.push(name);
            }
            if (
              /(?:javascript\s*:|https?\s*:|\/\/)/i.test(value) &&
              (name === 'href' || name === 'xlink:href' || name === 'src')
            ) {
              activeFindings.push(`${name}=${value}`);
            }
            for (const match of value.matchAll(
              /url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/gi,
            )) {
              referenceCount += 1;
              if (!ids.has(match[1]))
                unresolvedFragmentRefs.push(`#${match[1]}`);
            }
            if (
              (name === 'href' || name === 'xlink:href') &&
              value.startsWith('#')
            ) {
              referenceCount += 1;
              if (!ids.has(value.slice(1))) unresolvedFragmentRefs.push(value);
            }
            if (
              (name === 'aria-labelledby' || name === 'aria-describedby') &&
              value
            ) {
              for (const reference of value.split(/\s+/u).filter(Boolean)) {
                referenceCount += 1;
                if (!ids.has(reference))
                  unresolvedFragmentRefs.push(`#${reference}`);
              }
            }
            if (
              /url\(/i.test(value) &&
              !/url\(\s*['"]?#[^)'"\s]+['"]?\s*\)/i.test(value)
            ) {
              activeFindings.push(`${name}=${value}`);
            }
          }
        }
        return {
          parseError: parseError ?? null,
          rootName: root?.localName?.toLowerCase() ?? null,
          namespace: root?.namespaceURI ?? null,
          width: Number(root?.getAttribute('width')),
          height: Number(root?.getAttribute('height')),
          viewBox: root?.getAttribute('viewBox') ?? null,
          activeFindings,
          unresolvedFragmentRefs,
          referenceCount,
        };
      };
      const render = async (source, viewport) => {
        const blob = new Blob([source], { type: 'image/svg+xml' });
        const image = await createImageBitmap(blob, {
          resizeWidth: viewport.width,
          resizeHeight: viewport.height,
          resizeQuality: 'high',
        });
        try {
          const canvas = new OffscreenCanvas(viewport.width, viewport.height);
          const context = canvas.getContext('2d', {
            willReadFrequently: true,
          });
          context.clearRect(0, 0, viewport.width, viewport.height);
          context.drawImage(image, 0, 0, viewport.width, viewport.height);
          return context.getImageData(0, 0, viewport.width, viewport.height)
            .data;
        } finally {
          image.close();
        }
      };
      const inputSource = decodeText(input);
      const outputSource = decodeText(output);
      const renders = [];
      for (const viewport of viewports) {
        const before = await render(inputSource, viewport);
        const after = await render(outputSource, viewport);
        let changedPixels = 0;
        let maxChannelDelta = 0;
        let totalChannelDelta = 0;
        let inputNonTransparentPixels = 0;
        let outputNonTransparentPixels = 0;
        for (let index = 0; index < before.length; index += 4) {
          if (before[index + 3] > 0) inputNonTransparentPixels += 1;
          if (after[index + 3] > 0) outputNonTransparentPixels += 1;
          let changed = false;
          for (let channel = 0; channel < 4; channel += 1) {
            const delta = Math.abs(
              before[index + channel] - after[index + channel],
            );
            if (delta > 0) changed = true;
            maxChannelDelta = Math.max(maxChannelDelta, delta);
            totalChannelDelta += delta;
          }
          if (changed) changedPixels += 1;
        }
        renders.push({
          ...viewport,
          inputNonTransparentPixels,
          outputNonTransparentPixels,
          changedPixels,
          maxChannelDelta,
          totalChannelDelta,
        });
      }
      return {
        inputBytes: input.length,
        outputBytes: output.length,
        inputDocument: inspectDocument(inputSource),
        outputDocument: inspectDocument(outputSource),
        renders,
      };
    },
    { input: inputBytes, output: outputBytes, viewports: SVG_RENDER_VIEWPORTS },
  );
}

/** Runs the exact SVG-specific browser evidence without expanding the root runner. */
export async function proveSvgCompressionBrowser(args) {
  const inputBytes = [...(await fs.readFile(args.fixturePath))];
  const outputBytes = await args.capture.lastBlobBytes(args.page);
  const semantic = assertSvgRenderEquivalence(
    await inspectSvgRenderEquivalence(args.page, inputBytes, outputBytes),
  );
  const initialWorkerUrl = assertDedicatedWorker(
    args.initialWorkerUrls,
    args.page.url(),
    'SVG compression',
  );
  await args.capture.saveOutput(args.page, 'compress-svg.svg');
  await args.capture.saveScreenshot(args.page, 'compress-svg-success.png');

  const runAdditionalFixture = async (fixtureName) => {
    const workerUrls = [];
    const onWorker = (worker) => workerUrls.push(worker.url());
    args.page.on('worker', onWorker);
    try {
      await args.capture.hookBlob(args.page);
      const fixturePath = path.join(args.fixtureDirectory, fixtureName);
      await args.capture.dropFiles(args.page, '[data-testid="tool-dropzone"]', [
        fixturePath,
      ]);
      await args.capture.waitForBlob(args.page, 1, 20_000);
      return {
        input: [...(await fs.readFile(fixturePath))],
        output: await args.capture.lastBlobBytes(args.page),
        workerUrl: assertDedicatedWorker(
          workerUrls,
          args.page.url(),
          'Additional SVG run',
        ),
      };
    } finally {
      args.page.off('worker', onWorker);
    }
  };
  const noOp = await runAdditionalFixture('svg-compression-minimal.svg');
  assertExactFixtureBytes(noOp.output, noOp.input, 'SVG no-op output');
  const repeated = await runAdditionalFixture('svg-compression-complex.svg');
  assertExactFixtureBytes(
    repeated.output,
    outputBytes,
    'deterministic SVG output',
  );
  return {
    detail: `verified deterministic inert SVG at ${semantic.viewports} viewports, ${semantic.sizeOutcome} ${semantic.inputBytes}→${semantic.outputBytes} bytes, plus ${noOp.output.length}-byte honest no-op`,
    metrics: {
      inputBytes: semantic.inputBytes,
      outputBytes: semantic.outputBytes,
      outputType: args.blob.type,
      renderedViewports: semantic.viewports,
      workerUrl: initialWorkerUrl,
      noOpBytes: noOp.output.length,
      noOpWorkerUrl: noOp.workerUrl,
      repeatWorkerUrl: repeated.workerUrl,
    },
    checks: [
      'valid-fixture',
      'semantic-output',
      ...args.runNegativeProbe(),
      'required-environment',
    ],
  };
}
