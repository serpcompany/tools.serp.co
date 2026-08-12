import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { setMediaFilenameHeaders } from '../../../lib/media-filename-transport.ts';

const routeSource = readFileSync(
  new URL('./route.ts', import.meta.url),
  'utf8',
);

test('media-fetch constructs bounded ASCII and encoded Unicode filename response headers', () => {
  assert.match(
    routeSource,
    /setMediaFilenameHeaders\(headers, args\.fileName\)/,
  );
  assert.doesNotMatch(
    routeSource,
    /headers\.set\(["']x-media-filename["'], args\.fileName\)/,
  );

  const headers = new Headers();
  setMediaFilenameHeaders(headers, '東京 — café 🎵.mp3');
  const response = new Response(new Uint8Array([1, 2, 3]), { headers });

  assert.equal(response.headers.get('x-media-filename'), '-- - caf- -.mp3');
  assert.equal(
    response.headers.get('x-media-filename-encoded'),
    '%E6%9D%B1%E4%BA%AC%20%E2%80%94%20caf%C3%A9%20%F0%9F%8E%B5.mp3',
  );
  for (const value of response.headers.values()) {
    assert.ok(value.length <= 2_160);
    assert.ok(
      Array.from(value).every((character) => character.charCodeAt(0) <= 0xff),
    );
  }
});
