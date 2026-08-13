import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { toolJourneys } from './tool-journeys.ts';
import { buildToolClientFirstPlan } from './tool-client-first-plan.ts';
import { buildToolFactoryReadModel } from './tool-factory-read-model.ts';
import {
  buildGoldenToolJourneyPilotView,
  goldenToolJourneyPilot,
} from './golden-tool-journey-pilot.ts';

const EXPECTED_JOURNEY_IDS = Object.freeze([
  'audio-to-text:extractor-url',
  'audio-to-text:upload',
  'audio-to-transcript:direct-url',
  'batch-compress-png:multiple-file-upload',
  'bmp-to-png:upload',
  'compress-pdf:upload',
  'csv-to-json:upload',
  'pdf-reader:upload',
  'png-to-webp:upload',
  'video-downloader:direct-url',
]);

test('Golden pilot freezes the exact representative Tool Journey portfolio', () => {
  assert.deepEqual(
    goldenToolJourneyPilot.journeys.map((journey) => journey.id),
    EXPECTED_JOURNEY_IDS,
  );
  assert.equal(
    goldenToolJourneyPilot.membershipHash,
    'sha256:cf077705f900e695b0310fbd090dbd366fa3c01219f93b2076f849b3396ba6ba',
  );
  assert.equal(
    goldenToolJourneyPilot.membershipHash,
    `sha256:${createHash('sha256')
      .update(JSON.stringify(EXPECTED_JOURNEY_IDS))
      .digest('hex')}`,
  );
  assert.equal(new Set(EXPECTED_JOURNEY_IDS).size, 10);
  for (const journey of goldenToolJourneyPilot.journeys) {
    assert.equal(
      toolJourneys.getByToolId(journey.toolId).includes(journey),
      true,
    );
    assert.ok(journey.fixture.reference, journey.id);
    assert.ok(journey.semanticInvariant.id, journey.id);
  }
  assert.throws(
    () =>
      (
        goldenToolJourneyPilot.journeys as unknown as (typeof toolJourneys.all)[number][]
      ).push(toolJourneys.all[0]!),
    TypeError,
  );
});

test('Golden pilot names the user behavior each exact journey represents', () => {
  assert.deepEqual(goldenToolJourneyPilot.behaviors, {
    clientFileConversion: ['png-to-webp:upload', 'bmp-to-png:upload'],
    structuredData: ['csv-to-json:upload'],
    batch: ['batch-compress-png:multiple-file-upload'],
    pdf: ['pdf-reader:upload'],
    transcriptionUpload: ['audio-to-text:upload'],
    transcriptionDirectUrl: ['audio-to-transcript:direct-url'],
    truthfulYoutubeUnsupported: ['audio-to-text:extractor-url'],
    directMediaDownload: ['video-downloader:direct-url'],
    serverUnavailable: ['compress-pdf:upload'],
    adversarialChecks: ['png-to-webp:upload'],
    cancellation: ['audio-to-text:upload'],
  });
});

test('Golden pilot projects the human decision table from source-owned Tool facts and retained evidence', () => {
  const tools = buildToolFactoryReadModel();
  const clientFirst = buildToolClientFirstPlan(tools.rows);
  const pilot = buildGoldenToolJourneyPilotView(tools.rows, clientFirst.rows);

  assert.equal(pilot.rows.length, 10);
  assert.equal(
    Object.values(pilot.summary).reduce((total, value) => total + value, 0),
    10,
  );
  assert.deepEqual(
    pilot.rows.map((row) => row.journeyId),
    EXPECTED_JOURNEY_IDS,
  );
  for (const row of pilot.rows) {
    assert.match(row.tryHref, /^\/[a-z0-9/-]+\/$/);
    assert.ok(row.resultLabel);
    assert.ok(row.whereItRuns);
    assert.ok(row.checkedBehavior);
    assert.ok(row.freshness);
    assert.ok(row.remainingGap);
    assert.equal(
      row.evidenceState,
      tools
        .getByToolId(row.toolId)
        ?.verificationEvidence.find(
          (evidence) => evidence.journeyId === row.journeyId,
        )?.state,
    );
  }
  assert.throws(
    () => (pilot.rows as unknown as (typeof pilot.rows)[number][]).pop(),
    TypeError,
  );
});
