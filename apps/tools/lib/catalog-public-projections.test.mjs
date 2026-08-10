import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { toolCatalog } from '../../../packages/app-core/src/lib/tool-catalog.ts';
import { getToolLinkCategories } from './tool-link-categories.ts';

const toolsLinkHubProjection = getToolLinkCategories();

const acceptedProjectionSnapshots = {
  categories: {
    expectedItemCount: 10,
    observedItemCount: toolCatalog.directoryCategories.length,
    projection: toolCatalog.directoryCategories,
    sha256: 'bb2b4687fdca361e6dc928f8a368efea57a664009ef4fc0f5a6eb5e9826c3116',
  },
  homepageDirectory: {
    expectedItemCount: 2807,
    observedItemCount: toolCatalog.directoryEntries.length,
    projection: toolCatalog.directoryEntries,
    sha256: '8cacf223b853270997d71967801b1368e4dfa68b12c120e4b2211866bdf7b5ef',
  },
  toolsLinkHub: {
    expectedItemCount: 2807,
    observedItemCount: toolsLinkHubProjection.reduce(
      (count, category) => count + category.tools.length,
      0,
    ),
    projection: toolsLinkHubProjection,
    sha256: '7f6e1bf6524cdb6484f8be5d470dec80d4b8568cc0bbfe9a45998e2635254962',
  },
};

test('public Catalog projections preserve accepted routes, membership, counts, and order', () => {
  for (const [name, snapshot] of Object.entries(acceptedProjectionSnapshots)) {
    const sha256 = createHash('sha256')
      .update(JSON.stringify(snapshot.projection))
      .digest('hex');

    assert.equal(
      snapshot.observedItemCount,
      snapshot.expectedItemCount,
      `${name} item count`,
    );
    assert.equal(sha256, snapshot.sha256, `${name} projection digest`);
  }
});
