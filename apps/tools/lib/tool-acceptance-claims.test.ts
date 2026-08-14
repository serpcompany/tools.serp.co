import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createToolAcceptanceClaims,
  toolAcceptanceClaims,
} from './tool-acceptance-claims.ts';

test('canonical acceptance claims account for every active Tool exactly once', () => {
  assert.equal(toolAcceptanceClaims.all.length, 2_807);
  assert.deepEqual(toolAcceptanceClaims.counts, {
    supported: 437,
    unsupported: 2_367,
    unwired: 0,
    unknown: 3,
  });
  assert.equal(
    toolAcceptanceClaims.memberships.all.sha256,
    'sha256:fadb77ac2e1c68c14863a3ebd4ca43cde6692e9bde72bfacaf1026b8baeda030',
  );
  assert.equal(
    Object.values(toolAcceptanceClaims.memberships.byDisposition).reduce(
      (total, membership) => total + membership.toolIds.length,
      0,
    ),
    toolAcceptanceClaims.all.length,
  );
  assert.equal(
    new Set(
      Object.values(toolAcceptanceClaims.memberships.byDisposition).flatMap(
        (membership) => membership.toolIds,
      ),
    ).size,
    toolAcceptanceClaims.all.length,
  );
});

test('canonical claims expose capability reasons and source pointers without evidence dimensions', () => {
  const supported = toolAcceptanceClaims.getByToolId('png-to-webp');
  const unsupported = toolAcceptanceClaims.getByToolId('3g2-to-mp4');
  const unknown = toolAcceptanceClaims.getByToolId('audio-editor');

  assert.deepEqual(supported, {
    toolId: 'png-to-webp',
    disposition: 'supported',
    adapterId: 'generic-conversion',
    reason: null,
    sourcePointers: {
      catalog: 'packages/app-core/src/lib/tool-catalog.ts',
      processor: 'apps/tools/lib/tool-processor-registry.ts',
      contract: 'apps/tools/lib/generic-tool-contract.ts',
    },
  });
  assert.equal(unsupported?.disposition, 'unsupported');
  assert.match(
    unsupported?.reason ?? '',
    /no exact generic processor and semantic verifier contract/i,
  );
  assert.equal(
    unsupported?.sourcePointers.contract,
    'apps/tools/lib/generic-tool-contract.ts',
  );
  assert.equal(unknown?.disposition, 'unknown');
  assert.match(
    unknown?.reason ?? '',
    /No maintained execution mapping exists for this Tool renderer/,
  );
  assert.equal(Object.hasOwn(supported ?? {}, 'verificationEvidence'), false);
  assert.equal(Object.hasOwn(supported ?? {}, 'runtimeObservation'), false);
  assert.equal(Object.hasOwn(supported ?? {}, 'status'), false);
  assert.throws(() => {
    (toolAcceptanceClaims.all as unknown[]).push({});
  }, TypeError);
});

test('acceptance claims fail closed when processor and contract facts contradict', () => {
  assert.throws(
    () =>
      createToolAcceptanceClaims([
        {
          toolId: 'contradiction',
          renderer: 'generic',
          availability: {
            kind: 'wired',
            adapterId: 'generic-conversion',
          },
          genericContract: {
            state: 'unsupported',
            reason: 'Explicitly unsupported.',
          },
          tablePolicy: { kind: 'not-applicable', reason: null },
        },
      ]),
    /contradictory processor acceptance facts for contradiction/i,
  );
});
