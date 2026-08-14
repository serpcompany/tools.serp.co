import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { recordRunEvidence } from './lib/run-evidence.mjs';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const membership =
  'sha256:2e8404b30c9b954d51d697be77e5e3bc6faf8c9b3a5e942cfb75e56e86d4986e';
export const ICO_CANDIDATE_WORKER_MAX_BYTES = 128 * 1_024;
export const ICO_CANDIDATE_TERMINATION_STAGES = Object.freeze([
  'decode',
  'select',
  'verify',
]);

export function parseIcoPreviewCandidateArguments(arguments_) {
  const options = { baseUrl: '', revision: '' };
  for (let index = 0; index < arguments_.length; index += 1) {
    const field = new Map([
      ['--base-url', 'baseUrl'],
      ['--revision', 'revision'],
    ]).get(arguments_[index]);
    if (!field) throw new Error(`Unknown argument ${arguments_[index]}`);
    options[field] = arguments_[index + 1] ?? '';
    index += 1;
  }
  if (!/^https:\/\//.test(options.baseUrl)) {
    throw new Error('Candidate proof requires an HTTPS preview URL.');
  }
  const hostname = new URL(options.baseUrl).hostname;
  if (!hostname.includes('preview') || hostname === 'tools.serp.co') {
    throw new Error('Candidate proof refuses non-preview targets.');
  }
  if (!/^[0-9a-f]{40}$/.test(options.revision)) {
    throw new Error('Candidate proof requires an exact 40-character revision.');
  }
  return options;
}

export function discoverIcoWorkerChunkId(source) {
  if (!source.includes('convert-ico-to-png')) return undefined;
  const chunkId = Number(
    /new Worker\([\s\S]{0,240}?\.u\((\d+)\)/.exec(source)?.[1],
  );
  return Number.isSafeInteger(chunkId) ? chunkId : undefined;
}

function exactHead() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
}

export async function proveIcoPreviewCandidate(arguments_) {
  const options = parseIcoPreviewCandidateArguments(arguments_);
  if (exactHead() !== options.revision) {
    throw new Error('Candidate proof revision must equal Git HEAD.');
  }
  if (
    execFileSync('git', ['status', '--porcelain'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }).trim()
  ) {
    throw new Error('Candidate proof requires a clean worktree.');
  }

  const startedAt = new Date();
  let browser;
  try {
    const fixture = await fs.readFile(
      path.join(
        repositoryRoot,
        'apps/tools/benchmarks/fixtures/ico/selection.ico',
      ),
    );
    browser = await chromium.launch();
    const context = await browser.newContext();
    const accessCookie = process.env.TOOL_FACTORY_CF_AUTHORIZATION ?? '';
    if (accessCookie) {
      await context.addCookies([
        {
          name: 'CF_Authorization',
          value: accessCookie,
          domain: new URL(options.baseUrl).hostname,
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
      ]);
    }
    const page = await context.newPage();
    const uploadedFixtureRequests = [];
    page.on('request', (request) => {
      const body = request.postDataBuffer();
      if (body?.includes(fixture)) uploadedFixtureRequests.push(request.url());
    });
    const response = await page.goto(`${options.baseUrl}/ico-to-png/`, {
      waitUntil: 'networkidle',
    });
    if (!response?.ok())
      throw new Error(`Preview returned ${response?.status()}.`);

    const proof = await page.evaluate(
      async (input) => {
        const { fixtureBytes, terminationStages, workerMaxBytes } = input;
        const resources = performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((url) => /\/_next\/static\/chunks\/.*\.js(?:\?|$)/.test(url));
        let workerChunkId;
        for (const url of resources) {
          const source = await (await fetch(url)).text();
          if (!source.includes('convert-ico-to-png')) continue;
          workerChunkId = Number(
            /new Worker\([\s\S]{0,240}?\.u\((\d+)\)/.exec(source)?.[1],
          );
          if (Number.isSafeInteger(workerChunkId)) break;
        }
        if (!Number.isSafeInteger(workerChunkId)) {
          throw new Error(
            'ICO Worker chunk id was not discoverable from the preview.',
          );
        }
        let webpackRequire;
        window.webpackChunk_N_E.push([
          [`ico-proof-${Date.now()}`],
          {},
          (runtime) => {
            webpackRequire = runtime;
          },
        ]);
        if (!webpackRequire)
          throw new Error('Next.js runtime was unavailable.');
        const workerUrl = new URL(
          webpackRequire.p + webpackRequire.u(workerChunkId),
          location.href,
        ).href;
        const workerResponse = await fetch(workerUrl);
        if (!workerResponse.ok)
          throw new Error('ICO Worker asset was unavailable.');
        const workerAssetBytes = (await workerResponse.arrayBuffer())
          .byteLength;
        if (workerAssetBytes < 1 || workerAssetBytes > workerMaxBytes) {
          throw new Error(
            `ICO Worker asset exceeded its budget: ${workerAssetBytes}.`,
          );
        }

        const run = async (bytes, terminateStage) =>
          await new Promise((resolve, reject) => {
            const worker = new Worker(workerUrl, { type: 'module' });
            const stages = [];
            let terminalMessages = 0;
            const timeout = setTimeout(() => {
              worker.terminate();
              reject(new Error('ICO candidate Worker timed out.'));
            }, 10_000);
            worker.onerror = (event) => {
              clearTimeout(timeout);
              worker.terminate();
              reject(
                new Error(event.message || 'ICO candidate Worker failed.'),
              );
            };
            worker.onmessage = (event) => {
              if (event.data?.type === 'progress') {
                stages.push(event.data.stage);
                if (event.data.stage === terminateStage) {
                  worker.terminate();
                  setTimeout(() => {
                    clearTimeout(timeout);
                    resolve({
                      terminatedAt: terminateStage,
                      stages,
                      terminalMessages,
                    });
                  }, 100);
                }
                return;
              }
              terminalMessages += 1;
              clearTimeout(timeout);
              worker.terminate();
              resolve({ ...event.data, stages, terminalMessages });
            };
            const input = Uint8Array.from(bytes).buffer;
            worker.postMessage({ type: 'convert-ico-to-png', input }, [input]);
          });

        const [first, second] = await Promise.all([
          run(fixtureBytes),
          run(fixtureBytes),
        ]);
        for (const result of [first, second]) {
          if (
            result.ok !== true ||
            result.width !== 128 ||
            result.height !== 80 ||
            result.selectedIndex !== 1 ||
            result.sourceKind !== 'png' ||
            result.pixelVerified !== true
          ) {
            throw new Error(
              'ICO candidate selected or verified the wrong entry.',
            );
          }
        }
        const hash = async (buffer) =>
          [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
            .map((value) => value.toString(16).padStart(2, '0'))
            .join('');
        const firstHash = await hash(first.png);
        const secondHash = await hash(second.png);
        if (firstHash !== secondHash)
          throw new Error('ICO output was nondeterministic.');

        const bitmap = await createImageBitmap(
          new Blob([first.png], { type: 'image/png' }),
        );
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0);
        const rgba = context.getImageData(
          0,
          0,
          bitmap.width,
          bitmap.height,
        ).data;
        bitmap.close();
        for (let offset = 0; offset < rgba.length; offset += 4) {
          if (
            rgba[offset] !== 253 ||
            rgba[offset + 1] !== 165 ||
            rgba[offset + 2] !== 0 ||
            rgba[offset + 3] !== 255
          ) {
            throw new Error(
              'ICO output pixels differ from the selected fixture.',
            );
          }
        }

        const malformed = await run(fixtureBytes.slice(0, 12));
        const spoofedPng = fixtureBytes.slice(fixtureBytes.length - 279);
        const spoofed = await run(spoofedPng);
        if (malformed.ok !== false || spoofed.ok !== false) {
          throw new Error('ICO candidate accepted malformed or spoofed input.');
        }
        const terminations = [];
        for (const stage of terminationStages) {
          const result = await run(fixtureBytes, stage);
          if (
            result.terminatedAt !== stage ||
            result.terminalMessages !== 0 ||
            !result.stages.includes(stage)
          ) {
            throw new Error(
              `ICO ${stage} termination leaked a terminal response.`,
            );
          }
          terminations.push(result);
        }
        return {
          workerUrl,
          workerAssetBytes,
          outputSha256: firstHash,
          selectedIndex: first.selectedIndex,
          width: first.width,
          height: first.height,
          terminations,
        };
      },
      {
        fixtureBytes: [...fixture],
        terminationStages: ICO_CANDIDATE_TERMINATION_STAGES,
        workerMaxBytes: ICO_CANDIDATE_WORKER_MAX_BYTES,
      },
    );
    if (uploadedFixtureRequests.length !== 0) {
      throw new Error('ICO candidate uploaded user bytes.');
    }

    const completedAt = new Date();
    const artifact = recordRunEvidence({
      repositoryRoot,
      command: 'prove:ico-preview-candidate',
      commandVersion: '1',
      revision: options.revision,
      environment: 'preview',
      scope: 'ico-to-png-unregistered-candidate',
      status: 'success',
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      retentionClass: 'pull-request',
      inputHashes: [membership],
      linkedWork: ['#144'],
      summary: {
        status: 'success',
        checksPassed: 8,
        checksFailed: 0,
        items: 1,
        bytes: proof.workerAssetBytes,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    });
    console.log(
      JSON.stringify({ ...proof, uploadedFixtureRequests, ...artifact }),
    );
  } catch (error) {
    const completedAt = new Date();
    recordRunEvidence({
      repositoryRoot,
      command: 'prove:ico-preview-candidate',
      commandVersion: '1',
      revision: options.revision,
      environment: 'preview',
      scope: 'ico-to-png-unregistered-candidate',
      status: 'failure',
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      retentionClass: 'pull-request',
      inputHashes: [membership],
      linkedWork: ['#144'],
      summary: {
        status: 'failure',
        checksPassed: 0,
        checksFailed: 1,
        items: 1,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    });
    throw error;
  } finally {
    await browser?.close();
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await proveIcoPreviewCandidate(process.argv.slice(2));
}
