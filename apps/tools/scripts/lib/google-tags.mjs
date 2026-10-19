// The Google tags a GTM container loads must answer 200. Until 2026-10-19,
// GTM-PP9W77LK loaded gtag/js?id=G-6N5GK54MWY, which Google had answered 404
// for days on every page: GA4 recorded nothing and no check noticed (#346 F1).
// scripts/check-google-tags.mjs runs this after each deploy (#348).

// Must match the GTM id in gtag-manager.tsx (pinned by a test).
export const GTM_CONTAINER = "GTM-PP9W77LK";

const GTM_ORIGIN = "https://www.googletagmanager.com";

export function containerUrl(containerId) {
  return `${GTM_ORIGIN}/gtm.js?id=${encodeURIComponent(containerId)}`;
}

export function googleTagUrl(tagId) {
  return `${GTM_ORIGIN}/gtag/js?id=${encodeURIComponent(tagId)}`;
}

// gtm.js holds the container's tags and variables ("macros") as a JSON object
// after `"resource":`. Returns it, or null if it isn't there.
export function containerResource(containerScript) {
  const key = containerScript.indexOf('"resource":');
  const start = key === -1 ? -1 : containerScript.indexOf("{", key);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < containerScript.length; index += 1) {
    const char = containerScript[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "{" || char === "[") {
      depth += 1;
    } else if ((char === "}" || char === "]") && --depth === 0) {
      try {
        return JSON.parse(containerScript.slice(start, index + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

// The ids a container loads gtag/js for: each Google tag's (__googtag) Tag ID
// (G-, GT-, AW-, DC-), typed in or set from a Constant variable (__c). Other
// tags load no script. A GA4 Event tag (__gaawe) sends to a destination that
// a Google tag set up, and that destination's own gtag/js can answer 404:
// G-6N5GK54MWY does, though GA4 records it through GT-T9CQH2XR. A Tag ID from
// any other kind of variable can't be read here and counts as unresolved.
export function googleTags(resource) {
  const macros = Array.isArray(resource.macros) ? resource.macros : [];
  const tagIds = (Array.isArray(resource.tags) ? resource.tags : [])
    .filter((tag) => tag?.function === "__googtag")
    .map(({ vtp_tagId: tagId }) => {
      if (typeof tagId === "string") return tagId;
      const macro = Array.isArray(tagId) && tagId[0] === "macro" ? macros[tagId[1]] : null;
      return macro?.function === "__c" && typeof macro.vtp_value === "string"
        ? macro.vtp_value
        : null;
    });
  return {
    ids: [...new Set(tagIds.filter(Boolean))],
    unresolved: tagIds.filter((tagId) => !tagId).length,
  };
}

// No answer, a 5xx, a timeout (408) or rate limiting (429) means Google is
// unavailable, not that a tag is wrong, so it warns instead of failing.
function unavailable(answer) {
  return answer.status === null || answer.status >= 500 || [408, 429].includes(answer.status);
}

function describe(answer) {
  return answer.status === null ? answer.error : `answered ${answer.status}`;
}

async function get(fetchImpl, url, { timeoutMs, headers, readBody }) {
  try {
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    const body = readBody ? await response.text() : "";
    if (!readBody) await response.body?.cancel();
    return { status: response.status, body, error: null };
  } catch (error) {
    return {
      status: null,
      body: "",
      error: error instanceof Error ? error.message : "request failed",
    };
  }
}

// Returns { state: "passed" | "failed" | "warning", message, tags }, where
// tags maps each id the container loads to its gtag/js status (or the error).
export async function checkGoogleTags(
  containerId,
  { fetch: fetchImpl = globalThis.fetch, timeoutMs = 30_000, headers = {} } = {},
) {
  const outcome = (state, message, tags = {}) => ({ state, message, tags });
  const options = { timeoutMs, headers };
  const container = await get(fetchImpl, containerUrl(containerId), { ...options, readBody: true });
  if (unavailable(container)) {
    return outcome(
      "warning",
      `couldn't read ${containerId}'s gtm.js (${describe(container)}), so its Google tags weren't checked`,
    );
  }
  if (container.status !== 200) {
    return outcome("failed", `${containerId}'s gtm.js ${describe(container)}`);
  }
  const resource = containerResource(container.body);
  if (!resource) {
    return outcome(
      "warning",
      `couldn't find the tags in ${containerId}'s gtm.js, so its Google tags weren't checked`,
    );
  }
  const { ids, unresolved } = googleTags(resource);
  if (ids.length === 0 && unresolved === 0) {
    return outcome("warning", `${containerId} loads no Google tag`);
  }

  const answers = await Promise.all(
    ids.map(async (id) => ({ id, ...(await get(fetchImpl, googleTagUrl(id), options)) })),
  );
  const tags = Object.fromEntries(
    answers.map((answer) => [answer.id, answer.status ?? answer.error]),
  );
  const list = (selected) =>
    selected.map((answer) => `${answer.id} (${describe(answer)})`).join(", ");

  const broken = answers.filter((answer) => !unavailable(answer) && answer.status !== 200);
  if (broken.length > 0) {
    return outcome(
      "failed",
      `${containerId} loads Google tags whose gtag/js doesn't answer 200: ${list(broken)}`,
      tags,
    );
  }
  const unreached = answers.filter(unavailable);
  const notes = [
    ...(unreached.length > 0 ? [`couldn't check ${list(unreached)}`] : []),
    ...(unresolved > 0
      ? [`${unresolved} Google tag(s) take their Tag ID from a variable this check can't read`]
      : []),
  ];
  if (notes.length > 0) {
    return outcome("warning", `${containerId}: ${notes.join("; ")}`, tags);
  }
  return outcome(
    "passed",
    `${containerId} loads ${ids.join(", ")}, and each gtag/js answers 200`,
    tags,
  );
}

// What scripts/check-google-tags.mjs prints and its exit code. Under GitHub
// Actions a failure or warning is also an annotation on the run.
export function outcomeReport({ state, message, tags }, { githubActions = false } = {}) {
  const annotation = { failed: "::error::", warning: "::warning::" }[state];
  return {
    lines: [
      `${githubActions && annotation ? annotation : ""}Google tags ${state}: ${message}`,
      ...Object.entries(tags).map(([id, status]) => `  ${googleTagUrl(id)}: ${status}`),
    ],
    exitCode: state === "failed" ? 1 : 0,
  };
}
