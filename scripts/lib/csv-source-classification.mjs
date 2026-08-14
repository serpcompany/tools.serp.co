export const allowedCsvSourceClassifications = new Set([
  'fixture',
  'generated projection',
  'dated advisory evidence',
  'obsolete input',
]);

export const prohibitedOperationalCsvClassifications = new Set([
  'dated advisory evidence',
  'obsolete input',
]);

export function parseCsvSourceClassifications(source) {
  const entries = [];
  const rowPattern = /^\|\s+`([^`]+\.csv)`\s+\|\s+`([^`]+)`\s+\|/gm;
  let match;
  while ((match = rowPattern.exec(source)) !== null) {
    entries.push({ path: match[1], classification: match[2] });
  }
  return entries;
}
