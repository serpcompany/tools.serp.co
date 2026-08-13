import { operationalToolCatalog as catalog } from '../../packages/app-core/src/lib/tool-catalog-adapter.mjs';
import {
  AUDIO_FORMATS,
  VIDEO_FORMATS,
} from '../../apps/tools/lib/capabilities.ts';
import { resolveCompressionDispatch } from '../../apps/tools/lib/compression-utils.ts';
import {
  resolveConversionCapability,
  resolveConversionDispatch,
} from '../../apps/tools/lib/convert/conversion-dispatch.ts';
import { getGenericToolContract } from '../../apps/tools/lib/generic-tool-workflow.ts';
import { getTableOperationPolicy } from '../../apps/tools/lib/table-operation-policy.ts';
import {
  executionProvenance,
  getToolExecutionProvenance,
} from '../../apps/tools/lib/tool-execution-provenance.ts';
import { getToolProcessorAvailability } from '../../apps/tools/lib/tool-processor-registry.ts';
import { selectToolRenderer } from '../../apps/tools/lib/tool-renderer.ts';
import { classifyToolAcceptance } from './tool-acceptance-classification.mjs';
import {
  createMembership,
  createToolExpansionGapReadModel,
} from './tool-expansion-gap-read-model.mjs';

const SOURCES = Object.freeze({
  catalog: 'packages/app-core/src/lib/tool-catalog-adapter.mjs',
  renderer: 'apps/tools/lib/tool-renderer.ts',
  processor: 'apps/tools/lib/tool-processor-registry.ts',
  provenance: 'apps/tools/lib/tool-execution-provenance.ts',
  conversionDispatch: 'apps/tools/lib/convert/conversion-dispatch.ts',
  compressionDispatch: 'apps/tools/lib/compression-utils.ts',
  genericContract: 'apps/tools/lib/generic-tool-workflow.ts',
  tablePolicy: 'apps/tools/lib/table-operation-policy.ts',
  planning: 'scripts/lib/build-tool-expansion-gap.mjs#planning-policy-v1',
});
const CURRENT_SUPPORTED_COUNT = 436;

const audioFormats = new Set(AUDIO_FORMATS);
const videoFormats = new Set(VIDEO_FORMATS);
const rasterFormats = new Set([
  'apng',
  'arw',
  'avif',
  'bmp',
  'cr2',
  'cr3',
  'cur',
  'dds',
  'dng',
  'eps',
  'gif',
  'heic',
  'heif',
  'ico',
  'icns',
  'jpeg',
  'jfif',
  'jif',
  'jpg',
  'jxl',
  'ktx',
  'ktx2',
  'nef',
  'orf',
  'pam',
  'pbm',
  'pcx',
  'pgm',
  'png',
  'ppm',
  'psd',
  'raf',
  'rw2',
  'svg',
  'tga',
  'tif',
  'tiff',
  'webp',
  'xbm',
  'xcf',
]);
const nativeOrServerFormats = new Set([
  'ai',
  'arw',
  'cr2',
  'cr3',
  'dng',
  'eps',
  'heic',
  'heif',
  'nef',
  'orf',
  'psd',
  'raf',
  'rw2',
  'xcf',
]);

function formatFamily(format, renderer) {
  if (!format) return 'none';
  if (renderer === 'table') return 'structured-data';
  if (audioFormats.has(format)) return 'audio';
  if (videoFormats.has(format)) return 'video';
  if (format === 'pdf' || format === 'ai') return 'document';
  if (rasterFormats.has(format)) return 'raster-image';
  return 'specialized-or-unclassified';
}

function exactDispatchCapability(tool, renderer) {
  if (
    renderer === 'generic' &&
    tool.operation === 'convert' &&
    tool.from &&
    tool.to
  ) {
    const capability = resolveConversionCapability(tool.from, tool.to);
    const dispatch = resolveConversionDispatch(tool.from, tool.to);
    return {
      key: `conversion:${dispatch.kind}:${capability.supported ? 'exact-capability' : 'no-exact-capability'}`,
      capable: capability.supported,
      dispatchKind: dispatch.kind,
      engineIds: [...dispatch.engineIds],
      reason: capability.supported ? null : capability.reason,
      source: SOURCES.conversionDispatch,
    };
  }
  if (renderer === 'generic' && tool.operation === 'compress' && tool.from) {
    const dispatch = resolveCompressionDispatch(tool.from);
    const capable = dispatch.target !== 'unsupported';
    return {
      key: `compression:${dispatch.target}:${capable ? 'dispatch-present' : 'no-dispatch'}`,
      capable,
      dispatchKind: dispatch.target,
      engineIds: [...dispatch.engineIds],
      reason: capable
        ? null
        : `No compression dispatch exists for ${tool.from}.`,
      source: SOURCES.compressionDispatch,
    };
  }
  if (renderer === 'table') {
    const policy = getTableOperationPolicy(tool.id);
    return {
      key: `table:${policy.kind}:${tool.to ?? 'no-output'}`,
      capable: policy.kind === 'eligible',
      dispatchKind: policy.kind,
      engineIds: policy.kind === 'eligible' ? ['browser-table-converter'] : [],
      reason: policy.kind === 'eligible' ? null : policy.reason,
      source: SOURCES.tablePolicy,
    };
  }
  return {
    key: `renderer:${renderer}:not-applicable`,
    capable: null,
    dispatchKind: 'not-applicable',
    engineIds: [],
    reason: null,
    source: SOURCES.renderer,
  };
}

function runtimeCompatibility(provenance) {
  if (provenance.kind === 'unknown') {
    return {
      classification: 'unknown',
      executionProfiles: ['unknown'],
      reason: provenance.reason,
      source: SOURCES.provenance,
    };
  }
  const needsRuntimeProof = provenance.executionProfiles.some(
    (profile) => profile !== 'client-only',
  );
  return {
    classification: needsRuntimeProof
      ? 'declared-server-path-needs-environment-proof'
      : 'declared-client-only',
    executionProfiles: [...provenance.executionProfiles],
    reason: needsRuntimeProof
      ? 'An execution profile names repository server participation; this projection does not prove deployed runtime compatibility.'
      : 'The maintained provenance declares only browser execution; this is a declaration, not a runtime result.',
    source: SOURCES.provenance,
  };
}

function contractEvidence(tool, renderer) {
  if (renderer === 'generic') {
    const contract = getGenericToolContract(tool.id);
    return {
      kind: contract.state,
      reason: contract.state === 'unsupported' ? contract.reason : null,
      source: SOURCES.genericContract,
    };
  }
  if (renderer === 'table') {
    const policy = getTableOperationPolicy(tool.id);
    return {
      kind: policy.kind,
      reason: policy.kind === 'eligible' ? null : policy.reason,
      source: SOURCES.tablePolicy,
    };
  }
  return { kind: 'renderer-owned', reason: null, source: SOURCES.renderer };
}

function blockersFor({
  disposition,
  tool,
  renderer,
  provenance,
  availability,
  exact,
  contract,
  runtime,
}) {
  if (disposition === 'supported') return [];
  const blockers = [];
  if (disposition === 'unknown') {
    blockers.push({
      code: 'unresolved-product-intent',
      detail: provenance.reason,
      resolutionPath: provenance.sourceNeeded,
      source: SOURCES.provenance,
    });
    return blockers;
  }
  if (availability.kind !== 'wired') {
    blockers.push({
      code: 'no-production-adapter',
      detail: availability.reason,
      source: SOURCES.processor,
    });
  }
  if (exact.capable === false) {
    blockers.push({
      code: 'missing-exact-input-output-capability',
      detail: exact.reason,
      source: exact.source,
    });
  }
  if (renderer === 'table') {
    blockers.push({
      code:
        tool.to === 'png' || tool.to === 'jpeg'
          ? 'semantic-validator-gap'
          : 'serializer-gap',
      detail: contract.reason,
      source: SOURCES.tablePolicy,
    });
  } else if (disposition === 'unsupported') {
    blockers.push({
      code: 'semantic-verifier-or-contract-gap',
      detail: contract.reason,
      source: SOURCES.genericContract,
    });
  }
  if (
    runtime.classification === 'declared-server-path-needs-environment-proof'
  ) {
    blockers.push({
      code: 'runtime-proof-gap',
      detail: runtime.reason,
      source: SOURCES.provenance,
    });
  }
  return blockers;
}

function feasibilityFor({ disposition, tool, renderer, exact, provenance }) {
  let classification;
  let rationale;
  if (disposition === 'supported') {
    classification = 'existing-maintained-engine';
    rationale =
      'A registered production adapter and controlled processor contract already exist.';
  } else if (disposition === 'unknown') {
    classification = 'unresolved';
    rationale =
      'No maintained implementation provenance exists, so feasibility cannot be inferred.';
  } else if (tool.operation === 'convert' && tool.from === tool.to) {
    classification = 'invalid-or-duplicate-catalog-intent';
    rationale =
      'A conversion with identical canonical input and output needs product review before implementation.';
  } else if (renderer === 'table') {
    classification = 'new-maintained-dependency';
    rationale =
      'The accepted table policy names a serializer or independent visible-content validator gap.';
  } else if (exact.capable === true) {
    classification = 'existing-maintained-engine';
    rationale =
      'Exact dispatch names a maintained engine; contract, semantic, and runtime proof still gate registration.';
  } else if (
    nativeOrServerFormats.has(tool.from ?? '') ||
    nativeOrServerFormats.has(tool.to ?? '') ||
    (provenance.kind === 'mapped' &&
      provenance.executionProfiles.includes('server-executed'))
  ) {
    classification = 'native-or-server-infrastructure';
    rationale =
      'The format or maintained provenance requires a native/server execution decision before implementation.';
  } else {
    classification = 'unresolved';
    rationale =
      'No exact capability or accepted dependency/runtime choice exists.';
  }
  return { classification, rationale, source: SOURCES.planning };
}

function priorityFor(feasibility) {
  const scoreByClassification = {
    'existing-maintained-engine': 80,
    'new-maintained-dependency': 50,
    'native-or-server-infrastructure': 30,
    unresolved: 20,
    'invalid-or-duplicate-catalog-intent': 10,
  };
  return {
    score: scoreByClassification[feasibility.classification],
    rationale:
      'Planning heuristic only: favors an existing maintained engine over dependency, infrastructure, unresolved, or Catalog-retirement work; it contains no traffic or revenue evidence.',
    source: SOURCES.planning,
  };
}

function processorFamily(tool, renderer, exact) {
  if (renderer === 'generic')
    return `generic-${tool.operation}:${exact.dispatchKind}`;
  if (renderer === 'table') return `table-output:${tool.to ?? 'unknown'}`;
  return `renderer:${renderer}`;
}

function buildRow(tool) {
  const renderer = selectToolRenderer(tool);
  const availability = getToolProcessorAvailability(tool.id);
  const provenance = getToolExecutionProvenance(tool.id);
  const genericContractState = getGenericToolContract(tool.id).state;
  const tablePolicyKind = getTableOperationPolicy(tool.id).kind;
  const disposition = classifyToolAcceptance({
    availabilityKind: availability.kind,
    renderer,
    genericContractState,
    tablePolicyKind,
  });
  const exact = exactDispatchCapability(tool, renderer);
  const contract = contractEvidence(tool, renderer);
  const runtime = runtimeCompatibility(provenance);
  const feasibility = feasibilityFor({
    disposition,
    tool,
    renderer,
    exact,
    provenance,
  });
  const processorEvidence = {
    kind: availability.kind,
    adapterId: availability.kind === 'wired' ? availability.adapterId : null,
    reason: availability.kind === 'wired' ? null : availability.reason,
    source: SOURCES.processor,
  };
  return {
    toolId: tool.id,
    acceptedDisposition: disposition,
    evidence: {
      catalogIntent: {
        operation: tool.operation,
        renderer,
        inputFormat: tool.from,
        outputFormat: tool.to,
        route: tool.canonicalRoute,
        source: SOURCES.catalog,
      },
      processorAvailability: processorEvidence,
      processorContract: contract,
      implementationProvenance: {
        kind: provenance.kind,
        engineIds:
          provenance.kind === 'mapped' ? [...provenance.engineIds] : [],
        reason: provenance.kind === 'unknown' ? provenance.reason : null,
        sourceNeeded:
          provenance.kind === 'unknown' ? provenance.sourceNeeded : null,
        source: SOURCES.provenance,
      },
      exactDispatchCapability: exact,
      controlledVerification: {
        evidenceKind: 'versioned-contract-policy',
        classification:
          disposition === 'supported'
            ? 'registered-with-semantic-policy'
            : disposition === 'unsupported'
              ? 'explicit-fail-closed-contract'
              : 'not-verified',
        retainedPerToolExecutionResult: false,
        reason:
          disposition === 'supported'
            ? 'The accepted baseline registers an adapter behind a semantic policy; a fresh clone does not contain a retained execution result for this Tool id.'
            : disposition === 'unsupported'
              ? 'The accepted contract fails closed and supplies no positive operation result.'
              : 'No maintained provenance exists from which to define a controlled verification contract.',
        source:
          disposition === 'supported'
            ? SOURCES.processor
            : renderer === 'table'
              ? SOURCES.tablePolicy
              : disposition === 'unknown'
                ? SOURCES.provenance
                : SOURCES.genericContract,
      },
      runtimeCompatibility: runtime,
    },
    blockers: blockersFor({
      disposition,
      tool,
      renderer,
      provenance,
      availability,
      exact,
      contract,
      runtime,
    }),
    planning: {
      inputFamily: formatFamily(tool.from, renderer),
      outputFamily: formatFamily(tool.to, renderer),
      processorFamily: processorFamily(tool, renderer, exact),
      feasibility,
      priority: priorityFor(feasibility),
      source: SOURCES.planning,
    },
  };
}

function recommendation(id, title, rows, details) {
  const membership = createMembership(rows.map((row) => row.toolId));
  return {
    id,
    title,
    ...membership,
    expectedCoverageDelta: membership.count,
    expectedSupportedCount: CURRENT_SUPPORTED_COUNT + membership.count,
    ...details,
    planningSource: SOURCES.planning,
  };
}

function buildRecommendations(rows) {
  const unsupported = rows.filter(
    (row) => row.acceptedDisposition === 'unsupported',
  );
  const browserRaster = unsupported.filter(
    (row) =>
      row.evidence.exactDispatchCapability.key ===
        'conversion:browser-raster:exact-capability' &&
      row.planning.feasibility.classification === 'existing-maintained-engine',
  );
  const tableRaster = unsupported.filter(
    (row) =>
      row.evidence.catalogIntent.renderer === 'table' &&
      ['jpeg', 'png'].includes(row.evidence.catalogIntent.outputFormat),
  );
  const serverImage = unsupported.filter(
    (row) =>
      row.evidence.exactDispatchCapability.key ===
        'conversion:server-image:exact-capability' &&
      row.planning.feasibility.classification === 'existing-maintained-engine',
  );
  return [
    recommendation(
      'browser-raster-exact-capability',
      'Verify the bounded browser-raster gap',
      browserRaster,
      {
        dependencies: [
          'Existing browser-raster-worker dispatch',
          'Exact MIME and semantic validator contracts',
        ],
        risks: [
          'Platform decoder/encoder variation',
          'Same-format Catalog duplicates require exclusion or retirement review',
        ],
        semanticTestStrategy:
          'For each retained pair, use real positive fixtures plus spoofed, malformed, empty, truncated, and wrong-format outputs; validate decoded dimensions/content before delivery.',
      },
    ),
    recommendation(
      'table-raster-semantic-validator',
      'Adopt and prove a table-to-raster semantic validator',
      tableRaster,
      {
        dependencies: [
          'Maintained table renderer or serializer',
          'Independent visible-content validator',
        ],
        risks: [
          'A decodable image can still omit columns or rows',
          'Font and layout variation can make pixel snapshots brittle',
        ],
        semanticTestStrategy:
          'Decode the raster independently and verify visible headers, cells, row cardinality, dimensions, and truncation behavior across positive, malformed, oversized, and cancellation fixtures.',
      },
    ),
    recommendation(
      'server-image-exact-capability',
      'Prove the exact server-image conversion family',
      serverImage,
      {
        dependencies: [
          'Existing server-image-convert dispatch',
          'Authorized compatible runtime decision before registration',
        ],
        risks: [
          'Native binaries are not implied Cloudflare-compatible',
          'High memory inputs and malformed image parser exposure',
        ],
        semanticTestStrategy:
          'Use format-specific decode and metadata assertions on real and adversarial fixtures, enforce byte/pixel limits, and require authorized preview evidence for the chosen server runtime.',
      },
    ),
  ];
}

export function buildToolExpansionGapReadModel({
  baselineRevision,
  reproducerSourceRevision = baselineRevision,
}) {
  const rows = catalog.activeTools.map(buildRow);
  return createToolExpansionGapReadModel({
    baselineRevision,
    reproducerSourceRevision,
    rows,
    expectedCounts: {
      supported: CURRENT_SUPPORTED_COUNT,
      unsupported: 2_368,
      unwired: 0,
      unknown: 3,
    },
    recommendations: buildRecommendations(rows),
    referenceData: {
      executionEngines: executionProvenance.engines.map((engine) => ({
        ...engine,
        source: SOURCES.provenance,
      })),
      sources: SOURCES,
      planningPolicy:
        'Format-family, processor-family, feasibility, and priority fields are planning assumptions. They do not change evidence or accepted dispositions.',
    },
  });
}

export { SOURCES as TOOL_EXPANSION_GAP_SOURCES };
