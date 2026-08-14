import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createToolAcceptanceClaims,
  toolAcceptanceClaims,
} from './tool-acceptance-claims.ts';

test('canonical acceptance claims account for every active Tool exactly once', () => {
  assert.equal(toolAcceptanceClaims.all.length, 2_807);
  assert.deepEqual(toolAcceptanceClaims.counts, {
    supported: 440,
    unsupported: 2_364,
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
    sourceNeeded: null,
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
  assert.match(
    unknown?.sourceNeeded ?? '',
    /Trace the active renderer to the function that performs its core operation/,
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
  assert.throws(
    () =>
      createToolAcceptanceClaims([
        {
          toolId: 'missing-wiring',
          renderer: 'table',
          availability: {
            kind: 'unwired',
            reason: 'No processor is registered.',
            sourceNeeded: 'Register the exact processor.',
          },
          genericContract: { state: 'not-applicable', reason: null },
          tablePolicy: { kind: 'eligible', reason: null },
        },
      ]),
    /contradictory processor acceptance facts for missing-wiring/i,
  );
});

test('public constructor exposes and deeply freezes every disposition', () => {
  const claims = createToolAcceptanceClaims([
    {
      toolId: 'supported-tool',
      renderer: 'generic',
      availability: { kind: 'wired', adapterId: 'generic-conversion' },
      genericContract: { state: 'supported', reason: null },
      tablePolicy: { kind: 'not-applicable', reason: null },
    },
    {
      toolId: 'unsupported-tool',
      renderer: 'generic',
      availability: {
        kind: 'unwired',
        reason: 'No processor is registered.',
        sourceNeeded: 'Register the exact processor.',
      },
      genericContract: {
        state: 'unsupported',
        reason: 'The exact contract is unsupported.',
      },
      tablePolicy: { kind: 'not-applicable', reason: null },
    },
    {
      toolId: 'unwired-tool',
      renderer: 'specialized',
      availability: {
        kind: 'unwired',
        reason: 'No processor is registered.',
        sourceNeeded: 'Register the exact processor.',
      },
      genericContract: { state: 'not-applicable', reason: null },
      tablePolicy: { kind: 'not-applicable', reason: null },
    },
    {
      toolId: 'unknown-tool',
      renderer: 'placeholder',
      availability: {
        kind: 'unknown',
        reason: 'Trace the renderer owner.',
        sourceNeeded: 'Identify the maintained execution source.',
      },
      genericContract: { state: 'not-applicable', reason: null },
      tablePolicy: { kind: 'not-applicable', reason: null },
    },
  ]);

  assert.deepEqual(
    claims.all.map(({ toolId, disposition }) => ({ toolId, disposition })),
    [
      { toolId: 'supported-tool', disposition: 'supported' },
      { toolId: 'unknown-tool', disposition: 'unknown' },
      { toolId: 'unsupported-tool', disposition: 'unsupported' },
      { toolId: 'unwired-tool', disposition: 'unwired' },
    ],
  );
  assert.throws(() => {
    (claims.counts as { supported: number }).supported = 0;
  }, TypeError);
  assert.throws(() => {
    (claims.memberships.byDisposition.unwired.toolIds as string[]).push(
      'another-tool',
    );
  }, TypeError);
  assert.throws(() => {
    (
      claims.getByToolId('supported-tool')?.sourcePointers as {
        processor: string;
      }
    ).processor = 'different-owner';
  }, TypeError);
});

test('public constructor rejects malformed runtime source facts', () => {
  assert.throws(
    () =>
      createToolAcceptanceClaims([
        {
          toolId: 'malformed-tool',
          renderer: 'generic',
          availability: { kind: 'bogus' },
          genericContract: { state: 'supported', reason: null },
          tablePolicy: { kind: 'not-applicable', reason: null },
        } as never,
      ]),
    /invalid processor availability/i,
  );
  assert.throws(
    () =>
      createToolAcceptanceClaims([
        {
          toolId: 'misspelled-renderer',
          renderer: 'generci',
          availability: { kind: 'wired', adapterId: 'generic-conversion' },
          genericContract: { state: 'not-applicable', reason: null },
          tablePolicy: { kind: 'not-applicable', reason: null },
        } as never,
      ]),
    /require an identity/i,
  );
  assert.throws(
    () =>
      createToolAcceptanceClaims([
        {
          toolId: 'generic-without-contract',
          renderer: 'generic',
          availability: { kind: 'wired', adapterId: 'generic-conversion' },
          genericContract: { state: 'not-applicable', reason: null },
          tablePolicy: { kind: 'not-applicable', reason: null },
        },
      ]),
    /contradictory processor acceptance facts/i,
  );
  assert.throws(
    () =>
      createToolAcceptanceClaims([
        {
          toolId: 'table-with-unknown-contract',
          renderer: 'table',
          availability: { kind: 'wired', adapterId: 'table-conversion' },
          genericContract: { state: 'not-applicable', reason: null },
          tablePolicy: {
            kind: 'unknown',
            reason: 'No table contract is owned.',
          },
        },
      ]),
    /contradictory processor acceptance facts/i,
  );
});
