function words(value) {
  return String(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function wordEditDistance(left, right) {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

export function assertTranscriptMatchesFixture(
  observedTranscript,
  expectedTranscript,
  { maximumWordErrorRate = 0.35 } = {},
) {
  const observedWords = words(observedTranscript);
  const expectedWords = words(expectedTranscript);
  if (expectedWords.length < 5) {
    throw new TypeError(
      'Transcript fixture oracle must contain at least five words.',
    );
  }
  const wordErrors = wordEditDistance(observedWords, expectedWords);
  const wordErrorRate = wordErrors / expectedWords.length;
  if (!observedWords.length || wordErrorRate > maximumWordErrorRate) {
    throw new Error(
      `Transcript did not match the owned speech fixture (word error rate ${wordErrorRate.toFixed(3)}, maximum ${maximumWordErrorRate.toFixed(3)}).`,
    );
  }
  return Object.freeze({
    expectedWordCount: expectedWords.length,
    observedWordCount: observedWords.length,
    wordErrors,
    wordErrorRate,
  });
}
