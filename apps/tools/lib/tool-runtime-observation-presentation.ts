import type {
  ToolRuntimeFailureClassifier,
  ToolRuntimeObservationPortfolio,
} from './tool-runtime-observations.ts';

const failureLabels: Readonly<Record<ToolRuntimeFailureClassifier, string>> =
  Object.freeze({
    'processing-failed': 'Processing failed',
    cancelled: 'Cancelled',
    'unclassified-failure': 'Unclassified failure',
  });

function relativeAge(minutes: number) {
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} hr ago` : `${Math.floor(hours / 24)} days ago`;
}

export function presentToolRuntimeObservations(
  portfolio: ToolRuntimeObservationPortfolio,
  toolId: string,
) {
  const heading = 'Recent staging activity' as const;
  if (portfolio.state === 'unavailable') {
    return Object.freeze({
      state: 'unavailable' as const,
      heading,
      title:
        portfolio.environment === 'DEV/STAGING'
          ? ("Couldn't load staging activity" as const)
          : ('No recent staging data' as const),
      explanation: portfolio.reason,
    });
  }
  const tool = portfolio.tools.find((candidate) => candidate.toolId === toolId);
  if (!tool) {
    return Object.freeze({
      state: 'empty' as const,
      heading,
      title: 'No recent staging data' as const,
      explanation: `No completed attempts for this Tool appeared in the latest bounded 24-hour sample. The read stops after ${portfolio.source.rowLimit.toLocaleString()} portfolio rows, so this does not mean there was no usage outside that sample.`,
    });
  }
  return Object.freeze({
    state: 'loaded' as const,
    heading,
    sampleSummary: `DEV/STAGING · 24-hour window · ${portfolio.source.rowsRead.toLocaleString()} of at most ${portfolio.source.rowLimit.toLocaleString()} portfolio rows read.`,
    paths: Object.freeze(
      tool.paths.map((path) =>
        path.state === 'observed'
          ? Object.freeze({
              label: path.label,
              state: 'observed' as const,
              environment: path.environment,
              attempts: path.sampleSize,
              latestResult: `${path.lastResult === 'succeeded' ? 'Succeeded' : 'Failed'}${path.lastErrorClassifier ? ` · ${failureLabels[path.lastErrorClassifier]}` : ''}`,
              lastSeenAt: path.lastObservedAt,
              freshness: `${path.freshness === 'fresh' ? 'Fresh' : 'Stale'} · ${relativeAge(path.ageMinutes)}`,
            })
          : Object.freeze({
              label: path.label,
              state: 'no-observations' as const,
              explanation:
                'No matching attempts appeared in this bounded sample. This does not mean the path had no usage outside the window or row cap.',
            }),
      ),
    ),
    notice:
      'Runtime activity is time-bound evidence only. It does not change Catalog intent, implementation support, or test results.' as const,
  });
}
