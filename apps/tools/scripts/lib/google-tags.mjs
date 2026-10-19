// The Google tags a GTM container loads must answer 200. Until 2026-10-19,
// GTM-PP9W77LK loaded gtag/js?id=G-6N5GK54MWY, which Google had answered 404
// for days on every page: GA4 recorded nothing and no check noticed (#346 F1).
// scripts/smoke-cloudflare-api.mjs runs this after each deploy (#348).

const GTM_ORIGIN = "https://www.googletagmanager.com";

// Google tag (GT-), GA4 (G-) and Google Ads (AW-) ids, as quoted strings in
// the container's JavaScript, e.g. "vtp_tagId":"GT-T9CQH2XR".
const GOOGLE_TAG_ID = /"((?:G|GT|AW)-[A-Z0-9]{4,})"/g;

export function containerUrl(containerId) {
  return `${GTM_ORIGIN}/gtm.js?id=${encodeURIComponent(containerId)}`;
}

export function googleTagUrl(tagId) {
  return `${GTM_ORIGIN}/gtag/js?id=${encodeURIComponent(tagId)}`;
}

export function googleTagIds(containerScript) {
  return [...new Set(Array.from(containerScript.matchAll(GOOGLE_TAG_ID), (match) => match[1]))];
}

// No answer, or a 5xx, means Google is unavailable, not that a tag is wrong,
// so a Google outage warns instead of failing a deploy.
function unavailable(answer) {
  return answer.status === null || answer.status >= 500;
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
    return { status: null, body: "", error: error instanceof Error ? error.message : "request failed" };
  }
}

// Returns { state: "passed" | "failed" | "warning", message, tags }, where
// tags maps each id the container loads to its gtag/js status (or the error).
export async function checkGoogleTags(
  containerId,
  { fetch: fetchImpl = globalThis.fetch, timeoutMs = 30_000, headers = {} } = {},
) {
  const options = { timeoutMs, headers };
  const container = await get(fetchImpl, containerUrl(containerId), { ...options, readBody: true });
  if (unavailable(container)) {
    return {
      state: "warning",
      message: `couldn't read ${containerId}'s gtm.js (${describe(container)}), so its Google tags weren't checked`,
      tags: {},
    };
  }
  if (container.status !== 200) {
    return { state: "failed", message: `${containerId}'s gtm.js ${describe(container)}`, tags: {} };
  }

  const ids = googleTagIds(container.body);
  const answers = await Promise.all(
    ids.map(async (id) => ({ id, ...(await get(fetchImpl, googleTagUrl(id), options)) })),
  );
  const tags = Object.fromEntries(answers.map((answer) => [answer.id, answer.status ?? answer.error]));
  const list = (selected) => selected.map((answer) => `${answer.id} (${describe(answer)})`).join(", ");

  const broken = answers.filter((answer) => !unavailable(answer) && answer.status !== 200);
  if (broken.length > 0) {
    return {
      state: "failed",
      message: `${containerId} loads Google tags whose gtag/js doesn't answer 200: ${list(broken)}`,
      tags,
    };
  }
  const unreached = answers.filter(unavailable);
  if (unreached.length > 0) {
    return {
      state: "warning",
      message: `couldn't check ${containerId}'s Google tags ${list(unreached)}`,
      tags,
    };
  }
  return {
    state: "passed",
    message:
      ids.length > 0
        ? `${containerId} loads ${ids.join(", ")}, and each gtag/js answers 200`
        : `${containerId} loads no Google tag`,
    tags,
  };
}
