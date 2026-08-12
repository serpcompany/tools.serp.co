import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readMediaFilename,
  setMediaFilenameHeaders,
} from './media-filename-transport.ts';

test('the legacy raw Unicode header write throws before a response can stream', () => {
  const headers = new Headers();

  assert.throws(
    () => headers.set('x-media-filename', '東京 — café 🎵.mp3'),
    TypeError,
  );
});

test('Unicode media filenames cross response headers without changing the preferred name', () => {
  const headers = new Headers();

  assert.doesNotThrow(() => {
    setMediaFilenameHeaders(headers, '東京 — café 🎵.mp3');
  });

  assert.equal(
    headers.get('x-media-filename-encoded'),
    '%E6%9D%B1%E4%BA%AC%20%E2%80%94%20caf%C3%A9%20%F0%9F%8E%B5.mp3',
  );
  assert.equal(readMediaFilename(headers), '東京 — café 🎵.mp3');
});

test('existing ASCII filenames remain available to legacy clients', () => {
  const headers = new Headers();

  setMediaFilenameHeaders(headers, 'Episode 1 (final).mp3');

  assert.equal(headers.get('x-media-filename'), 'Episode 1 (final).mp3');
  assert.equal(readMediaFilename(headers), 'Episode 1 (final).mp3');
});

test('transport removes path and control injection while preserving safe quotes and combining characters', () => {
  const cases = [
    {
      input: 'family/../東京\\track\r\n\u0000.mp3',
      expected: 'family-..-東京-track.mp3',
    },
    {
      input: 'Cafe\u0301 "live".mp3',
      expected: 'Cafe\u0301 "live".mp3',
    },
  ];

  for (const fixture of cases) {
    const headers = new Headers();
    setMediaFilenameHeaders(headers, fixture.input);

    assert.equal(readMediaFilename(headers), fixture.expected);
    for (const value of headers.values()) {
      assert.ok(
        Array.from(value).every((character) => {
          const codePoint = character.codePointAt(0) ?? 0;
          return (
            codePoint >= 0x20 &&
            codePoint <= 0x7e &&
            character !== '/' &&
            character !== '\\'
          );
        }),
      );
    }
    assert.doesNotThrow(() => new Response(null, { headers }));
  }
});

test('very long filenames are bounded without dropping their media extension', () => {
  const headers = new Headers();

  setMediaFilenameHeaders(headers, `${'🎵'.repeat(1_000)}.mp3`);

  const preferred = headers.get('x-media-filename-encoded');
  const fallback = headers.get('x-media-filename');
  const decoded = readMediaFilename(headers);
  assert.ok(preferred);
  assert.ok(fallback);
  assert.ok(preferred.length <= 2_160);
  assert.ok(fallback.length <= 180);
  assert.ok(Array.from(decoded ?? '').length <= 180);
  assert.match(decoded ?? '', /\.mp3$/u);
});

test('clients sanitize fallback values when the preferred filename is absent or malformed', () => {
  const absentPreferred = {
    get(name: string) {
      return name === 'x-media-filename' ? '..\\unsafe\r\nname.mp3' : null;
    },
  };
  const malformedPreferred = new Headers({
    'x-media-filename': 'fallback.mp3',
    'x-media-filename-encoded': '%E0%A4%A',
  });

  assert.equal(readMediaFilename(absentPreferred), '..-unsafename.mp3');
  assert.equal(readMediaFilename(malformedPreferred), 'fallback.mp3');
});
