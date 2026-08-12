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
    sha256: '9f0c02e83a5776018991c965ee9a652e03653c27e0962260cab49407449287e4',
  },
  toolsLinkHub: {
    expectedItemCount: 2807,
    observedItemCount: toolsLinkHubProjection.reduce(
      (count, category) => count + category.tools.length,
      0,
    ),
    projection: toolsLinkHubProjection,
    sha256: 'af4fa6caa30dd88c40081e4057056862e17c567c07cc458d3150ec891124be5f',
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
