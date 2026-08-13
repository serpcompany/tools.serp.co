import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGoldenPilotSourceView } from './golden-pilot-source-view.ts';

test('Golden source view projects portfolio and planner expectations from current source owners', () => {
  const view = buildGoldenPilotSourceView();

  assert.equal(
    view.portfolioTotal,
    Object.values(view.portfolioCounts).reduce(
      (total, count) => total + count,
      0,
    ),
  );
  assert.equal(view.firstExpansionGroup.rank, 1);
  assert.equal(
    view.firstExpansionGroup.id,
    `family:${view.firstExpansionGroup.operationFamily}`,
  );
  assert.ok(view.firstExpansionGroup.unlockCount > 0);
  assert.ok(view.firstExpansionGroup.candidateEngineIdentities.length > 0);
  assert.ok(view.firstExpansionGroup.includedToolId);
  assert.ok(view.firstExpansionGroup.excludedToolId);
  assert.notEqual(
    view.firstExpansionGroup.includedToolId,
    view.firstExpansionGroup.excludedToolId,
  );
  assert.notEqual(
    view.firstExpansionGroup.operationFamily,
    'wave:heif-browser-libheif',
  );
  const pngCard = view.evidenceCards.find(
    (card) => card.journeyId === 'png-to-webp:upload',
  );
  assert.ok(pngCard);
  assert.equal(pngCard.label, 'Verified journey');
  assert.equal(
    pngCard.reason,
    'Current controlled evidence satisfies every required check.',
  );
});
