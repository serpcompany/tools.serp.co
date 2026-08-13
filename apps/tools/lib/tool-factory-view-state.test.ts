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
  profiles: ['Browser', 'Hybrid', 'Server', 'Unsupported', 'Unknown'],
  expansionGroups: [
    'family:generic-convert:adaptive-video',
    'family:generic-convert:browser-raster',
  ],
};

test('shareable Tool view round-trips search, filters, sorting, columns, page, and rows', () => {
  const view = parseToolFactoryView(
    '?q=audio&support=supported&family=renderer%3Atranscription&runs=Hybrid&target=browser-first&server=optional-fallback&browser=existing-browser-path&verification=registered-with-semantic-policy&sort=tool%3Adesc&columns=tool%2Csupport%2CexactTest&page=3&rows=100',
    options,
  );

  assert.deepEqual(view, {
    pilot: '',
    expansionGroup: '',
    search: 'audio',
    filters: {
      support: 'supported',
      family: 'renderer:transcription',
      currentExecution: 'Hybrid',
      preferredTarget: 'browser-first',
      serverDependency: 'optional-fallback',
      browserFeasibility: 'existing-browser-path',
      verification: 'registered-with-semantic-policy',
    },
    sorting: [{ id: 'tool', desc: true }],
    visibleColumns: ['tool', 'support', 'exactTest'],
    pageIndex: 2,
    pageSize: 100,
  });
  assert.equal(
    serializeToolFactoryView(view),
    '?q=audio&support=supported&family=renderer%3Atranscription&runs=Hybrid&target=browser-first&server=optional-fallback&browser=existing-browser-path&verification=registered-with-semantic-policy&sort=tool%3Adesc&columns=tool%2Csupport%2CexactTest&page=3&rows=100',
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

test('every displayed browser-opportunity value survives URL sharing', () => {
  const view = parseToolFactoryView('?browser=server-required', options);
  assert.equal(view.filters.browserFeasibility, 'server-required');
  assert.equal(serializeToolFactoryView(view), '?browser=server-required');
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

test('shareable Tool view round-trips one validated expansion group', () => {
  const view = parseToolFactoryView(
    '?expansion=family%3Ageneric-convert%3Aadaptive-video',
    options,
  );

  assert.equal(view.expansionGroup, 'family:generic-convert:adaptive-video');
  assert.equal(
    serializeToolFactoryView(view),
    '?expansion=family%3Ageneric-convert%3Aadaptive-video',
  );
});

test('unknown expansion group cannot enter canonical Tool view state', () => {
  const view = parseToolFactoryView(
    '?expansion=family%3Ainvented&support=unsupported',
    options,
  );

  assert.equal(view.expansionGroup, '');
  assert.equal(serializeToolFactoryView(view), '?support=unsupported');
  assert.equal(DEFAULT_TOOL_FACTORY_VIEW.expansionGroup, '');
});

test('Golden Pilot is a canonical shareable Tool Factory view', () => {
  const view = parseToolFactoryView('?pilot=golden', options);

  assert.equal(view.pilot, 'golden');
  assert.equal(serializeToolFactoryView(view), '?pilot=golden');
  assert.equal(DEFAULT_TOOL_FACTORY_VIEW.pilot, '');
  assert.equal(parseToolFactoryView('?pilot=invented', options).pilot, '');
});
