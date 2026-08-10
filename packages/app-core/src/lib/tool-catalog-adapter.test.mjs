import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOperationalToolCatalog,
  operationalToolCatalog,
} from './tool-catalog-adapter.mjs';
import { toolCatalog } from './tool-catalog.ts';

function expectedOperationalTool(tool) {
  const outboundLinks = [
    ...Object.entries(tool.content?.productLinks ?? {}).map(([field, url]) => ({
      toolId: tool.id,
      route: tool.route,
      field: `content.productLinks.${field}`,
      label: field,
      url,
      kind: 'product',
    })),
    ...(tool.content?.sourceLinks ?? []).map((link, index) => ({
      toolId: tool.id,
      route: tool.route,
      field: `content.sourceLinks[${index}].url`,
      label: link.label,
      url: link.url,
      kind: 'source',
    })),
  ];
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    operation: tool.operation,
    route: tool.route,
    canonicalRoute: `${tool.route.replace(/\/+$/, '')}/`,
    isActive: tool.isActive,
    from: tool.from,
    to: tool.to,
    requiresFFmpeg: tool.requiresFFmpeg,
    presentationTitle: tool.content?.tool.title ?? null,
    outboundLinks,
  };
}

test('operational adapter preserves every bounded public Catalog projection', () => {
  assert.deepEqual(
    operationalToolCatalog.tools,
    toolCatalog.tools.map(expectedOperationalTool),
  );
  assert.deepEqual(
    operationalToolCatalog.activeTools.map((tool) => tool.id),
    toolCatalog.activeTools.map((tool) => tool.id),
  );
  assert.deepEqual(
    operationalToolCatalog.categoryPaths,
    toolCatalog.directoryCategories.map((category) => category.href),
  );
  assert.deepEqual(
    operationalToolCatalog.operationCounts,
    Object.fromEntries(
      toolCatalog.directoryCategories.map((category) => [
        category.id,
        category.count,
      ]),
    ),
  );
});

test('operational adapter validates identity and returns deeply read-only projections', () => {
  assert.throws(
    () => createOperationalToolCatalog([{ id: 'invalid' }]),
    /name must be a non-empty string/,
  );
  assert.throws(
    () =>
      createOperationalToolCatalog([
        {
          id: 'alpha',
          name: 'Alpha',
          description: 'Alpha Tool',
          operation: 'convert',
          route: '/alpha',
          isActive: true,
        },
        {
          id: 'alpha',
          name: 'Duplicate',
          description: 'Duplicate Tool',
          operation: 'convert',
          route: '/duplicate',
          isActive: true,
        },
      ]),
    /duplicate Tool id: alpha/,
  );
  assert.throws(
    () => operationalToolCatalog.activeTools.push({}),
    TypeError,
  );
  const linkedTool = operationalToolCatalog.tools.find(
    (tool) => tool.outboundLinks.length,
  );
  assert.ok(linkedTool?.outboundLinks.length);
  assert.throws(() => linkedTool.outboundLinks.push({}), TypeError);
});
