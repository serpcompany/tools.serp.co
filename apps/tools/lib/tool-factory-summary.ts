export function formatToolFactorySummary(model: {
  rows: readonly unknown[];
  counts: Readonly<{
    supported: number;
    unsupported: number;
    unknown: number;
  }>;
}): string {
  return `${model.rows.length.toLocaleString('en-US')} active Tools · ${model.counts.supported.toLocaleString('en-US')} processor capable · ${model.counts.unsupported.toLocaleString('en-US')} explicitly processor-unsupported · ${model.counts.unknown.toLocaleString('en-US')} unknown`;
}
