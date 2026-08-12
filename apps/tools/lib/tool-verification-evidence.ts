export type ToolVerificationResult = 'passed' | 'failed';

type RetainedArtifact = Readonly<{
  runId: string;
  revision: string;
}>;

type EvidenceBase = Readonly<{
  evidenceId: string;
  verifiedAt: string;
  verifiedRevision: string;
  environment: string;
  result: ToolVerificationResult;
  checkedBehaviors: readonly string[];
  artifact: RetainedArtifact;
  screenshotUrl: string;
}>;

export type ExactToolVerificationEvidence = EvidenceBase &
  Readonly<{
    scope: 'exact-tool';
    toolId: string;
  }>;

export type FamilyVerificationEvidence = EvidenceBase &
  Readonly<{
    scope: 'family';
    family: string;
    toolIds: readonly string[];
  }>;

export type ToolVerificationEvidence =
  | ExactToolVerificationEvidence
  | FamilyVerificationEvidence;

export type ToolVerificationEvidenceView = Readonly<{
  exact: ExactToolVerificationEvidence | null;
  family: readonly FamilyVerificationEvidence[];
}>;

type KnownTool = Readonly<{ toolId: string; family: string }>;

const verifiedRevision = '03dc90f5213560ff61493dd058b877f9666b8338';
const screenshotRevision = 'be36a19617b779bccdfabb820a9a60e4250e1cdf';
const artifact = Object.freeze({
  runId: '20260812T083305Z_03dc90f_pull-request_browser-smoke-preview-subset',
  revision: verifiedRevision,
});

function screenshot(fileName: string) {
  return `https://github.com/serpcompany/tools.serp.co/blob/${screenshotRevision}/docs/audits/${fileName}`;
}

export const retainedToolVerificationEvidence: readonly ToolVerificationEvidence[] =
  Object.freeze([
    Object.freeze({
      evidenceId: 'preview-png-to-webp-2026-08-12',
      scope: 'exact-tool' as const,
      toolId: 'png-to-webp',
      verifiedAt: '2026-08-12T08:33:05.000Z',
      verifiedRevision,
      environment: 'DEV/STAGING preview',
      result: 'passed' as const,
      checkedBehaviors: Object.freeze([
        'Converted a real PNG and produced a WebP file.',
      ]),
      artifact,
      screenshotUrl: screenshot('workflow-preview-png-to-webp-2026-08-12.png'),
    }),
    Object.freeze({
      evidenceId: 'preview-audio-to-text-2026-08-12',
      scope: 'exact-tool' as const,
      toolId: 'audio-to-text',
      verifiedAt: '2026-08-12T08:33:05.000Z',
      verifiedRevision,
      environment: 'DEV/STAGING preview',
      result: 'passed' as const,
      checkedBehaviors: Object.freeze([
        'Transcribed a real speech MP3 into non-empty text.',
      ]),
      artifact,
      screenshotUrl: screenshot(
        'workflow-preview-audio-to-text-2026-08-12.png',
      ),
    }),
    Object.freeze({
      evidenceId: 'preview-transcription-family-2026-08-12',
      scope: 'family' as const,
      family: 'renderer:transcription',
      toolIds: Object.freeze(['audio-to-text']),
      verifiedAt: '2026-08-12T08:33:05.000Z',
      verifiedRevision,
      environment: 'DEV/STAGING preview',
      result: 'passed' as const,
      checkedBehaviors: Object.freeze([
        'The representative family browser run included real speech transcription for this Tool.',
      ]),
      artifact,
      screenshotUrl: screenshot(
        'workflow-preview-audio-to-text-2026-08-12.png',
      ),
    }),
    Object.freeze({
      evidenceId: 'preview-pdf-reader-2026-08-12',
      scope: 'exact-tool' as const,
      toolId: 'pdf-reader',
      verifiedAt: '2026-08-12T08:33:05.000Z',
      verifiedRevision,
      environment: 'DEV/STAGING preview',
      result: 'passed' as const,
      checkedBehaviors: Object.freeze([
        'Opened a real PDF and rendered page 1 in the maintained viewer.',
      ]),
      artifact,
      screenshotUrl: screenshot('workflow-preview-pdf-reader-2026-08-12.png'),
    }),
  ]);

function validateRevision(value: string, field: string) {
  if (!/^[a-f0-9]{40}$/.test(value)) {
    throw new TypeError(`${field} must be a full Git revision.`);
  }
}

function validateEvidence(
  evidence: ToolVerificationEvidence,
  knownById: ReadonlyMap<string, KnownTool>,
) {
  validateRevision(evidence.verifiedRevision, 'Evidence revision');
  validateRevision(evidence.artifact.revision, 'Artifact revision');
  if (evidence.artifact.revision !== evidence.verifiedRevision) {
    throw new TypeError(
      `Evidence ${evidence.evidenceId} artifact revision does not match its verified revision.`,
    );
  }
  if (!Number.isFinite(Date.parse(evidence.verifiedAt))) {
    throw new TypeError(`Evidence ${evidence.evidenceId} has an invalid date.`);
  }
  if (!evidence.checkedBehaviors.length) {
    throw new TypeError(
      `Evidence ${evidence.evidenceId} must name checked behavior.`,
    );
  }
  if (
    !/^https:\/\/github\.com\/serpcompany\/tools\.serp\.co\/blob\/[a-f0-9]{40}\//.test(
      evidence.screenshotUrl,
    )
  ) {
    throw new TypeError(
      `Evidence ${evidence.evidenceId} must link to a revision-pinned screenshot.`,
    );
  }

  if (evidence.scope === 'exact-tool') {
    if (!knownById.has(evidence.toolId)) {
      throw new TypeError(
        `Evidence ${evidence.evidenceId} names unknown Tool ${evidence.toolId}.`,
      );
    }
    return;
  }

  if (!evidence.toolIds.length) {
    throw new TypeError(
      `Family evidence ${evidence.evidenceId} has no Tool membership.`,
    );
  }
  for (const toolId of evidence.toolIds) {
    const tool = knownById.get(toolId);
    if (!tool) {
      throw new TypeError(
        `Evidence ${evidence.evidenceId} names unknown Tool ${toolId}.`,
      );
    }
    if (tool.family !== evidence.family) {
      throw new TypeError(
        `Evidence ${evidence.evidenceId} family does not match Tool ${toolId}.`,
      );
    }
  }
}

function newest<
  Evidence extends ExactToolVerificationEvidence | FamilyVerificationEvidence,
>(records: readonly Evidence[]): Evidence | null {
  return (
    [...records].sort(
      (left, right) =>
        Date.parse(right.verifiedAt) - Date.parse(left.verifiedAt),
    )[0] ?? null
  );
}

export function buildToolVerificationEvidenceIndex(
  records: readonly ToolVerificationEvidence[],
  knownTools: readonly KnownTool[],
) {
  const knownById = new Map(knownTools.map((tool) => [tool.toolId, tool]));
  if (knownById.size !== knownTools.length) {
    throw new TypeError('Known Tool evidence identities contain duplicates.');
  }
  const evidenceIds = new Set<string>();
  for (const evidence of records) {
    if (evidenceIds.has(evidence.evidenceId)) {
      throw new TypeError(`Duplicate evidence id: ${evidence.evidenceId}.`);
    }
    evidenceIds.add(evidence.evidenceId);
    validateEvidence(evidence, knownById);
  }

  return Object.freeze({
    getForTool(toolId: string, family: string): ToolVerificationEvidenceView {
      const exact = newest(
        records.filter(
          (record): record is ExactToolVerificationEvidence =>
            record.scope === 'exact-tool' && record.toolId === toolId,
        ),
      );
      const familyEvidence = records
        .filter(
          (record): record is FamilyVerificationEvidence =>
            record.scope === 'family' &&
            record.family === family &&
            record.toolIds.includes(toolId),
        )
        .sort(
          (left, right) =>
            Date.parse(right.verifiedAt) - Date.parse(left.verifiedAt),
        );
      return Object.freeze({ exact, family: Object.freeze(familyEvidence) });
    },
  });
}
