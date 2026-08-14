import { buildToolFactoryReadModel } from './tool-factory-read-model.ts';
import { formatToolFactorySummary } from './tool-factory-summary.ts';

const model = buildToolFactoryReadModel();

process.stdout.write(
  `${JSON.stringify({
    summaryText: formatToolFactorySummary(model),
    counts: model.counts,
    memberships: model.memberships,
  })}\n`,
);
