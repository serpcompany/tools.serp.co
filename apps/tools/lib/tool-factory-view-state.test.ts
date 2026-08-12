import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_TOOL_FACTORY_VIEW,
  clampToolFactoryPageIndex,
  parseToolFactoryView,
  serializeToolFactoryView,
} from './tool-factory-view-state.ts';

const options = {
  families: ['renderer:transcription', 'generic-convert:browser-raster'],
  profiles: ['client-only', 'server-assisted'],
};

test('shareable Tool view round-trips search, filters, sorting, columns, page, and rows', () => {
  const view = parseToolFactoryView(
    '?q=audio&support=supported&family=renderer%3Atranscription&profile=server-assisted&verification=registered-with-semantic-policy&sort=tool%3Adesc&columns=tool%2Csupport%2CexactTest&page=3&rows=100',
    options,
  );

  assert.deepEqual(view, {
    search: 'audio',
    filters: {
      support: 'supported',
      family: 'renderer:transcription',
      profile: 'server-assisted',
      verification: 'registered-with-semantic-policy',
    },
    sorting: [{ id: 'tool', desc: true }],
    visibleColumns: ['tool', 'support', 'exactTest'],
    pageIndex: 2,
    pageSize: 100,
  });
  assert.equal(
    serializeToolFactoryView(view),
    '?q=audio&support=supported&family=renderer%3Atranscription&profile=server-assisted&verification=registered-with-semantic-policy&sort=tool%3Adesc&columns=tool%2Csupport%2CexactTest&page=3&rows=100',
  );
});

test('invalid and obsolete URL values safely become the default view', () => {
  assert.deepEqual(
    parseToolFactoryView(
      '?support=broken&sort=missing%3Asideways&columns=missing&page=-2&rows=999&obsolete=yes',
      options,
    ),
    DEFAULT_TOOL_FACTORY_VIEW,
  );
  assert.equal(serializeToolFactoryView(DEFAULT_TOOL_FACTORY_VIEW), '');
});

test('empty or duplicate column values cannot hide every column or create unstable state', () => {
  assert.deepEqual(
    parseToolFactoryView('?columns=tool,tool,missing', options).visibleColumns,
    ['tool'],
  );
  assert.deepEqual(
    parseToolFactoryView('?columns=', options).visibleColumns,
    DEFAULT_TOOL_FACTORY_VIEW.visibleColumns,
  );
});

test('stale page numbers clamp to the last page that contains Tools', () => {
  assert.equal(clampToolFactoryPageIndex(999_998, 2_807, 50), 56);
  assert.equal(clampToolFactoryPageIndex(9, 0, 50), 0);
  assert.equal(clampToolFactoryPageIndex(1, 26, 25), 1);
});
