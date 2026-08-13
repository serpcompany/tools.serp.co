const EXPECTED_JOURNEYS = Object.freeze([
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

export function assertGoldenBrowserManifest(manifest) {
  const journeys = manifest.scope.tools.flatMap((tool) => tool.journeys);
  const byId = new Map(journeys.map((journey) => [journey.journeyId, journey]));
  if (
    journeys.length !== EXPECTED_JOURNEYS.length ||
    EXPECTED_JOURNEYS.some((journeyId) => !byId.has(journeyId))
  ) {
    throw new Error(
      'Golden browser evidence did not contain the fixed journey membership.',
    );
  }
  for (const journeyId of EXPECTED_JOURNEYS) {
    const journey = byId.get(journeyId);
    if (journeyId === 'compress-pdf:upload') {
      if (
        journey.outcome !== 'warned' ||
        journey.reasonCode !== 'browser-check-warning' ||
        !journey.checks.includes('no-delivery-on-failure')
      ) {
        throw new Error(
          'Golden server-unavailable journey was not an honest no-delivery warning.',
        );
      }
      continue;
    }
    if (
      journey.outcome !== 'passed' ||
      !journey.checks.includes('semantic-output')
    ) {
      throw new Error(
        `${journeyId} did not retain passed semantic-output evidence.`,
      );
    }
  }
  return journeys;
}
