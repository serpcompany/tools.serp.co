import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const fixture = JSON.parse(
  readFileSync(
    new URL('./fixtures/theme-bootstrap-d3e6c4c.json', import.meta.url),
    'utf8',
  ),
);
const appLayoutSource = readFileSync(
  new URL(
    '../../../packages/app-core/src/components/app-layout.tsx',
    import.meta.url,
  ),
  'utf8',
);

test('the pinned OpenNext preview bootstrap reproduces the deployed __name pageerror', () => {
  assert.equal(
    fixture.baselineRevision,
    'd3e6c4c44af0d0a6a8e243f4a4e61963bb838e87',
  );
  assert.equal(fixture.route, '/pdf-reader/');
  assert.equal(
    crypto.createHash('sha256').update(fixture.script).digest('hex'),
    fixture.scriptSha256,
  );

  assert.throws(
    () =>
      vm.runInNewContext(fixture.script, {
        document: {
          documentElement: {
            classList: { add() {}, remove() {} },
            setAttribute() {},
            style: {},
          },
        },
      }),
    (error) =>
      error?.name === 'ReferenceError' &&
      error?.message === '__name is not defined',
  );
});

test('the current shared shell cannot emit the failing theme bootstrap', () => {
  assert.match(appLayoutSource, /<html[^>]*className="light"/);
  assert.doesNotMatch(
    appLayoutSource,
    /next-themes|ThemeProvider|Providers|localStorage|__name/,
  );
});
