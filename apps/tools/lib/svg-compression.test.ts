import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  compressSvgWithWorker,
  SVG_COMPRESSION_LIMITS,
  verifySvgBytes,
} from './svg-compression.ts';

const svg = (source: string) => new TextEncoder().encode(source);

test('SVG policy accepts the owned complex semantic fixture', () => {
  const fixture = new Uint8Array(
    readFileSync(
      new URL(
        '../benchmarks/fixtures/svg-compression-complex.svg',
        import.meta.url,
      ),
    ),
  );

  assert.deepEqual(verifySvgBytes(fixture), { status: 'verified' });
});

test('owned SVG fixtures retain their exact provenance digests', () => {
  const provenance = JSON.parse(
    readFileSync(
      new URL('../benchmarks/fixture-provenance.json', import.meta.url),
      'utf8',
    ),
  );
  for (const name of [
    'svg-compression-complex.svg',
    'svg-compression-minimal.svg',
  ]) {
    const bytes = readFileSync(
      new URL(`../benchmarks/fixtures/${name}`, import.meta.url),
    );
    assert.equal(
      crypto.createHash('sha256').update(bytes).digest('hex'),
      provenance[`fixtures/${name}`]?.sha256,
      name,
    );
    assert.deepEqual(verifySvgBytes(new Uint8Array(bytes)), {
      status: 'verified',
    });
  }
});

test('SVG policy rejects an external stylesheet processing instruction', () => {
  const verification = verifySvgBytes(
    svg(
      '<?xml-stylesheet href="https://example.com/active.css"?><svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
    ),
  );

  assert.equal(verification.status, 'rejected');
  if (verification.status === 'rejected') {
    assert.match(verification.message, /processing instruction/i);
  }
});

test('SVG policy rejects character-reference-obfuscated JavaScript URLs', () => {
  const verification = verifySvgBytes(
    svg(
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="java&#x73;cript:alert(1)"><rect width="1" height="1"/></a></svg>',
    ),
  );

  assert.equal(verification.status, 'rejected');
  if (verification.status === 'rejected') {
    assert.match(verification.message, /JavaScript|external resource/i);
  }
});

test('SVG policy rejects xml:base because it can externalize fragment references', () => {
  const verification = verifySvgBytes(
    svg(
      '<svg xmlns="http://www.w3.org/2000/svg" xml:base="https://example.com/external.svg"><use href="#shape"/></svg>',
    ),
  );

  assert.equal(verification.status, 'rejected');
  if (verification.status === 'rejected') {
    assert.match(verification.message, /external resource/i);
  }
});

test('SVG policy resolves namespaced href attributes before allowing local references', () => {
  const verification = verifySvgBytes(
    svg(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:evil="http://www.w3.org/1999/xlink"><image evil:href="https://example.com/external.png"/></svg>',
    ),
  );

  assert.equal(verification.status, 'rejected');
  if (verification.status === 'rejected') {
    assert.match(verification.message, /external resource/i);
  }
});

test('SVG policy rejects SMIL elements that can activate attributes after load', () => {
  const verification = verifySvgBytes(
    svg(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect id="target" width="1" height="1"/><set href="#target" attributeName="fill" to="red" begin="0s"/></svg>',
    ),
  );

  assert.equal(verification.status, 'rejected');
  if (verification.status === 'rejected') {
    assert.match(verification.message, /set|active/i);
  }
});

test('SVG policy fails closed for malformed, active, external, and over-budget input', () => {
  const cases = [
    ['malformed', '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>'],
    ['doctype', '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>'],
    [
      'script',
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    ],
    [
      'event handler',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    ],
    [
      'external href',
      '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://example.com/a.svg#x"/></svg>',
    ],
    [
      'external CSS URL',
      '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://example.com/a.svg#x)"/></svg>',
    ],
    ['wrong root', '<html xmlns="http://www.w3.org/2000/svg"/>'],
    [
      'element limit',
      `<svg xmlns="http://www.w3.org/2000/svg">${'<g/>'.repeat(
        SVG_COMPRESSION_LIMITS.maxElements,
      )}</svg>`,
    ],
    [
      'depth limit',
      `<svg xmlns="http://www.w3.org/2000/svg">${'<g>'.repeat(
        SVG_COMPRESSION_LIMITS.maxDepth,
      )}${'</g>'.repeat(SVG_COMPRESSION_LIMITS.maxDepth)}</svg>`,
    ],
    [
      'attribute limit',
      `<svg xmlns="http://www.w3.org/2000/svg" ${Array.from(
        { length: SVG_COMPRESSION_LIMITS.maxAttributes },
        (_, index) => `a${index}=""`,
      ).join(' ')}/>`,
    ],
  ] as const;

  for (const [name, source] of cases) {
    assert.equal(verifySvgBytes(svg(source)).status, 'rejected', name);
  }
  assert.equal(
    verifySvgBytes(new Uint8Array([0xc3, 0x28])).status,
    'rejected',
    'invalid UTF-8',
  );
  assert.equal(
    verifySvgBytes(new Uint8Array(SVG_COMPRESSION_LIMITS.maxBytes + 1)).status,
    'rejected',
    'byte limit',
  );
});

test('SVG Worker client times out, ignores late output, and leaves termination to workflow cleanup', async () => {
  let posted = 0;
  let lateHandler: Worker['onmessage'] = null;
  const worker = {
    onerror: null,
    get onmessage() {
      return lateHandler;
    },
    set onmessage(value) {
      lateHandler = value;
    },
    postMessage() {
      posted += 1;
    },
  } as unknown as Worker;
  const controller = new AbortController();
  await assert.rejects(
    compressSvgWithWorker({
      worker,
      bytes: svg('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      signal: controller.signal,
      timeoutMs: 5,
    }),
    /timed out/i,
  );
  assert.equal(posted, 1);
  assert.equal(worker.onmessage, null);
});
