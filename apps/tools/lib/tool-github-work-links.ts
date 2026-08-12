export type ToolGithubWorkLink = Readonly<{
  kind: 'issue' | 'pull-request';
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  url: string;
  stateLabel: string;
}>;

type ToolScope = Readonly<{
  kind: 'tools';
  toolIds: readonly string[];
}>;

type FamilyScope = Readonly<{
  kind: 'family';
  family: string;
  toolIds: readonly string[];
}>;

export type ToolGithubWorkRecord = Readonly<{
  kind: 'issue' | 'pull-request';
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  url: string;
  scope: ToolScope | FamilyScope;
}>;

export type ToolGithubWorkView = Readonly<{
  tool: readonly ToolGithubWorkLink[];
  family: readonly ToolGithubWorkLink[];
}>;

const REPOSITORY_URL = 'https://github.com/serpcompany/tools.serp.co';

const transcriptionToolIds = Object.freeze([
  'audio-to-text',
  'audio-to-transcript',
  'mp3-to-transcript',
  'mp4-to-transcript',
  'tiktok-to-transcript',
  'video-to-transcript',
  'youtube-to-transcript',
  'youtube-to-transcript-generator',
]);

const bmpToolIds = Object.freeze([
  'bmp-to-jpeg',
  'bmp-to-jpg',
  'bmp-to-pdf',
  'bmp-to-png',
  'bmp-to-webp',
]);

// Associations are intentionally explicit. Titles are display copy only and
// never participate in Tool or family matching.
export const retainedToolGithubWorkLinks: readonly ToolGithubWorkRecord[] =
  Object.freeze([
    Object.freeze({
      kind: 'issue',
      number: 97,
      title: 'Fix Audio-to-Text for real YouTube links on Cloudflare',
      state: 'closed',
      url: `${REPOSITORY_URL}/issues/97`,
      scope: Object.freeze({
        kind: 'tools',
        toolIds: Object.freeze(['audio-to-text']),
      }),
    }),
    Object.freeze({
      kind: 'pull-request',
      number: 96,
      title:
        'DEV/STAGING — Tool refactor, verified families, and factory inputs',
      state: 'open',
      url: `${REPOSITORY_URL}/pull/96`,
      scope: Object.freeze({
        kind: 'tools',
        toolIds: Object.freeze(['audio-to-text', ...bmpToolIds]),
      }),
    }),
    Object.freeze({
      kind: 'issue',
      number: 95,
      title:
        'Enable and semantically verify the BMP input conversion family (5 IDs)',
      state: 'closed',
      url: `${REPOSITORY_URL}/issues/95`,
      scope: Object.freeze({
        kind: 'tools',
        toolIds: bmpToolIds,
      }),
    }),
    Object.freeze({
      kind: 'issue',
      number: 82,
      title: 'Consolidate downloader and transcription stream execution',
      state: 'closed',
      url: `${REPOSITORY_URL}/issues/82`,
      scope: Object.freeze({
        kind: 'family',
        family: 'renderer:transcription',
        toolIds: transcriptionToolIds,
      }),
    }),
    Object.freeze({
      kind: 'pull-request',
      number: 85,
      title:
        'Draft foundation — do not merge to main: Tool workflow architecture',
      state: 'open',
      url: `${REPOSITORY_URL}/pull/85`,
      scope: Object.freeze({
        kind: 'family',
        family: 'renderer:transcription',
        toolIds: transcriptionToolIds,
      }),
    }),
  ]);

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function stateLabel(record: ToolGithubWorkRecord) {
  if (record.kind === 'issue') {
    return record.state === 'open' ? 'Open issue' : 'Closed issue';
  }
  if (record.state === 'merged') return 'Merged pull request';
  return record.state === 'open' ? 'Open pull request' : 'Closed pull request';
}

function validateRecord(record: ToolGithubWorkRecord) {
  if (!Number.isSafeInteger(record.number) || record.number <= 0) {
    throw new TypeError('GitHub work number must be a positive integer.');
  }
  if (!record.title.trim()) {
    throw new TypeError(`GitHub work #${record.number} requires a title.`);
  }
  if (record.kind === 'issue' && record.state === 'merged') {
    throw new TypeError(`GitHub issue #${record.number} cannot be merged.`);
  }
  const expectedUrl = `${REPOSITORY_URL}/${record.kind === 'issue' ? 'issues' : 'pull'}/${record.number}`;
  if (record.url !== expectedUrl) {
    throw new TypeError(
      `GitHub work #${record.number} must use its canonical repository URL.`,
    );
  }
  if (!record.scope.toolIds.length) {
    throw new TypeError(
      `GitHub work #${record.number} requires explicit Tool ids.`,
    );
  }
  if (new Set(record.scope.toolIds).size !== record.scope.toolIds.length) {
    throw new TypeError(`GitHub work #${record.number} repeats a Tool id.`);
  }
}

function asLink(record: ToolGithubWorkRecord): ToolGithubWorkLink {
  return deepFreeze({
    kind: record.kind,
    number: record.number,
    title: record.title,
    state: record.state,
    stateLabel: stateLabel(record),
    url: record.url,
  });
}

function sameMembers(left: readonly string[], right: readonly string[]) {
  const sortedLeft = [...left].sort((a, b) => a.localeCompare(b));
  const sortedRight = [...right].sort((a, b) => a.localeCompare(b));
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

function sortLinks(links: ToolGithubWorkLink[]) {
  const stateRank = { open: 0, merged: 1, closed: 2 } as const;
  return links.sort(
    (left, right) =>
      stateRank[left.state] - stateRank[right.state] ||
      right.number - left.number,
  );
}

export function buildToolGithubWorkIndex(
  records: readonly ToolGithubWorkRecord[],
  memberships: readonly Readonly<{ toolId: string; family: string }>[],
) {
  const familyMembers = new Map<string, string[]>();
  const familyByToolId = new Map<string, string>();
  for (const membership of memberships) {
    if (familyByToolId.has(membership.toolId)) {
      throw new TypeError(`Duplicate Tool membership: ${membership.toolId}`);
    }
    familyByToolId.set(membership.toolId, membership.family);
    const members = familyMembers.get(membership.family) ?? [];
    members.push(membership.toolId);
    familyMembers.set(membership.family, members);
  }

  const recordsByToolId = new Map<string, ToolGithubWorkLink[]>();
  const recordsByFamily = new Map<string, ToolGithubWorkLink[]>();
  const identities = new Set<string>();
  for (const record of records) {
    validateRecord(record);
    const identity = `${record.kind}:${record.number}`;
    if (identities.has(identity)) {
      throw new TypeError(`Duplicate GitHub work record: ${identity}`);
    }
    identities.add(identity);
    for (const toolId of record.scope.toolIds) {
      if (!familyByToolId.has(toolId)) {
        throw new TypeError(
          `GitHub work #${record.number} references unknown Tool: ${toolId}`,
        );
      }
    }
    const link = asLink(record);
    if (record.scope.kind === 'family') {
      const actualMembers = familyMembers.get(record.scope.family);
      if (!actualMembers || !sameMembers(record.scope.toolIds, actualMembers)) {
        throw new TypeError(
          `GitHub work #${record.number} family membership does not match ${record.scope.family}.`,
        );
      }
      const familyLinks = recordsByFamily.get(record.scope.family) ?? [];
      familyLinks.push(link);
      recordsByFamily.set(record.scope.family, familyLinks);
    } else {
      for (const toolId of record.scope.toolIds) {
        const toolLinks = recordsByToolId.get(toolId) ?? [];
        toolLinks.push(link);
        recordsByToolId.set(toolId, toolLinks);
      }
    }
  }

  for (const links of recordsByToolId.values()) deepFreeze(sortLinks(links));
  for (const links of recordsByFamily.values()) deepFreeze(sortLinks(links));

  return deepFreeze({
    getForTool(toolId: string, family: string): ToolGithubWorkView {
      if (familyByToolId.get(toolId) !== family) {
        throw new TypeError(
          `Unknown Tool/family membership: ${toolId} / ${family}`,
        );
      }
      return deepFreeze({
        tool: recordsByToolId.get(toolId) ?? [],
        family: recordsByFamily.get(family) ?? [],
      });
    },
  });
}
