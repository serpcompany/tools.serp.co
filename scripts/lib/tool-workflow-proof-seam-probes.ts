import { createToolWorkflowTestHarness } from '../../apps/tools/lib/tool-workflow/testing.ts';

function media(
  name: string,
  format: string,
  mimeType: string,
  bytes: Uint8Array,
) {
  return { name, format, mimeType, bytes };
}

function terminalCount(records: ReadonlyArray<{ kind: string }>) {
  return records.filter(({ kind }) => kind === 'terminal').length;
}

export async function runCurrentSeamProbes({
  pngBytes,
  jpegBytes,
}: {
  pngBytes: Uint8Array;
  jpegBytes: Uint8Array;
}) {
  const lying = createToolWorkflowTestHarness({
    processors: {
      'png-to-jpg': {
        support: {
          acquisition: 'file',
          inputFormats: ['png'],
          outputFormats: ['jpg'],
        },
        result: media('lie.jpg', 'jpg', 'image/jpeg', pngBytes),
      },
    },
  });
  const lyingOutcome = await lying.workflow.run({
    toolId: 'png-to-jpg',
    input: {
      kind: 'file',
      media: media('valid.png', 'png', 'image/png', pngBytes),
    },
  });
  const lyingDelivered = lying.events.includes('delivery');
  const lyingReleased = lying.activeResources.length === 0;
  const lyingTerminals = terminalCount(lying.telemetryRecords);
  const lyingPassed =
    lyingOutcome.status === 'failed' &&
    lyingOutcome.error.code === 'invalid-result' &&
    !lyingDelivered &&
    lyingReleased &&
    lyingTerminals === 1;

  const cancellation = createToolWorkflowTestHarness({
    resources: {
      acquiring: ['reader', 'blob'],
      processing: ['worker'],
      validating: ['subscription'],
      delivering: ['object-url'],
    },
    processors: {
      'png-to-jpg': {
        support: {
          acquisition: 'file',
          inputFormats: ['png'],
          outputFormats: ['jpg'],
        },
        result: media('valid.jpg', 'jpg', 'image/jpeg', jpegBytes),
      },
    },
  });
  const controller = new AbortController();
  const cancellationOutcome = await cancellation.workflow.run(
    {
      toolId: 'png-to-jpg',
      input: {
        kind: 'file',
        media: media('valid.png', 'png', 'image/png', pngBytes),
      },
    },
    {
      signal: controller.signal,
      observe(snapshot) {
        if (snapshot.phase === 'delivering') {
          controller.abort('local proof cancellation');
        }
      },
    },
  );
  const cancellationDelivered = cancellation.events.includes('delivery');
  const cancellationReleased =
    cancellation.activeResources.length === 0 &&
    cancellation.openedResources.length > 0 &&
    cancellation.openedResources.toReversed().every(
      (resource, index) => cancellation.releasedResources[index] === resource,
    );
  const cancellationTerminals = terminalCount(cancellation.telemetryRecords);
  const cancellationPassed =
    cancellationOutcome.status === 'cancelled' &&
    !cancellationDelivered &&
    cancellationReleased &&
    cancellationTerminals === 1;

  return {
    lyingProcessor: {
      verdict: lyingPassed ? ('pass' as const) : ('fail' as const),
      outcome: lyingOutcome.status,
      errorCode:
        lyingOutcome.status === 'failed' ? lyingOutcome.error.code : undefined,
      delivered: lyingDelivered,
      resourcesReleased: lyingReleased,
      terminalCount: lyingTerminals,
    },
    cancellation: {
      verdict: cancellationPassed ? ('pass' as const) : ('fail' as const),
      outcome: cancellationOutcome.status,
      delivered: cancellationDelivered,
      resourcesReleased: cancellationReleased,
      terminalCount: cancellationTerminals,
      cancelledAt: 'delivering' as const,
    },
  };
}
