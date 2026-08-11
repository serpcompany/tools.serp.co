import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const renderers = ['HeroConverter.tsx', 'LanderHeroTwoColumn.tsx'];

test('generic renderers retain presentation without owning workflow internals', () => {
  for (const renderer of renderers) {
    const source = readFileSync(
      new URL(`../components/${renderer}`, import.meta.url),
      'utf8',
    );
    assert.match(source, /GenericToolWorkflow/);
    assert.doesNotMatch(source, /beginToolRun|finishSuccess|finishFailure/);
    assert.doesNotMatch(source, /saveBlob|convertWithWorker|compressFile/);
    assert.doesNotMatch(source, /new Worker|\.terminate\(|workerRef/);
  }
});
