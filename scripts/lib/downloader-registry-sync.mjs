import { createOperationalToolCatalog } from '../../packages/app-core/src/lib/tool-catalog-adapter.mjs';

const defaultOperatingSystems = [
  "windows",
  "mac",
  "linux",
  "chrome",
  "firefox",
  "edge",
  "brave",
  "opera",
];

const unreleasedPattern =
  /coming soon|waitlist|not available for download yet|not available yet|coming-soon|join the waitlist/i;

function normalizeToken(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function sourceSlugFromRepoSlug(repoSlug) {
  return repoSlug.replace(/-downloader$/, "").replace(/-video$/, "");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isLiveRegistryEntry(entry) {
  return !unreleasedPattern.test(JSON.stringify(entry));
}

function labelWord(word) {
  if (/^\d+k$/i.test(word)) return word.toUpperCase();
  if (/^hd$/i.test(word)) return "HD";
  if (/^vr$/i.test(word)) return "VR";
  if (/^tv$/i.test(word)) return "TV";
  if (/^xxx$/i.test(word)) return "XXX";
  if (/^m3u8$/i.test(word)) return "M3U8";
  if (/^\d+tube$/i.test(word)) return word.replace(/tube$/i, "Tube");
  if (/^\d+movies$/i.test(word)) return word.replace(/movies$/i, "Movies");
  if (/^\d+kporn$/i.test(word))
    return word.replace(/^(\d+)k/i, "$1K").replace(/porn$/i, "Porn");
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function humanizeSlug(slug) {
  return slug.split("-").filter(Boolean).map(labelWord).join(" ");
}

function sourceLabelFromEntry(entry, sourceSlug) {
  if (typeof entry.app_name === "string" && entry.app_name.trim()) {
    return entry.app_name
      .replace(/\s+video\s+downloader\s*$/i, "")
      .replace(/\s+downloader\s*$/i, "")
      .trim();
  }

  const shortMatch = String(entry.short_description ?? "").match(
    /^Download\s*&\s*Save\s+(.+?)\s+Videos\b/i,
  );
  if (shortMatch?.[1])
    return humanizeSlug(
      shortMatch[1].trim().toLowerCase().replace(/\s+/g, "-"),
    );

  return humanizeSlug(sourceSlug);
}

function titleFromEntry(entry, sourceLabel) {
  if (typeof entry.app_name === "string" && entry.app_name.trim()) {
    return entry.app_name.trim();
  }
  return `${sourceLabel} Video Downloader`;
}

function asTextList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function asFaqs(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((faq) => ({
      question: String(faq?.question ?? "").trim(),
      answer: String(faq?.answer ?? "").trim(),
    }))
    .filter((faq) => faq.question && faq.answer);
}

function sectionMarkdown(title, lines, options = {}) {
  if (!lines.length) return "";
  const body = options.list
    ? lines.map((line) => `- ${line}`).join("\n")
    : lines.join("\n\n");
  return `**${title}**\n\n${body}`;
}

function buildInfoArticle(entry, sourceLabel) {
  const content = entry.content ?? {};
  const blocks = [];

  if (
    typeof entry.long_description === "string" &&
    entry.long_description.trim()
  ) {
    blocks.push(entry.long_description.trim());
  }

  blocks.push(...asTextList(content.why));

  const howItWorks = asTextList(content.how_it_works);
  if (howItWorks.length)
    blocks.push(sectionMarkdown("How it works", howItWorks, { list: true }));

  const supportedFormats = asTextList(content.supported_formats);
  if (supportedFormats.length) {
    blocks.push(
      sectionMarkdown("Supported formats", supportedFormats, { list: true }),
    );
  }

  const troubleshooting = asTextList(content.troubleshooting);
  if (troubleshooting.length) {
    blocks.push(
      sectionMarkdown("Troubleshooting", troubleshooting, { list: true }),
    );
  }

  const notes = asTextList(content.notes);
  if (notes.length)
    blocks.push(sectionMarkdown("Notes", notes, { list: true }));

  if (!blocks.length) {
    blocks.push(
      `${sourceLabel} Video Downloader helps you save supported public ${sourceLabel} videos as MP4 files through the shared SERP downloader workflow.`,
    );
  }

  return {
    title: `About ${sourceLabel} video downloads`,
    markdown: blocks.join("\n\n"),
  };
}

function buildHowTo(entry, sourceLabel) {
  const content = entry.content ?? {};
  const steps =
    asTextList(content.tutorial).length >= 3
      ? asTextList(content.tutorial)
      : asTextList(content.how_it_works);

  return {
    title: `How to download a ${sourceLabel} video`,
    intro: `Follow these steps to save a supported ${sourceLabel} video link.`,
    steps:
      steps.length >= 3
        ? steps
        : [
            `Paste a public ${sourceLabel} video, page, or stream link.`,
            `Wait while we fetch the ${sourceLabel} video.`,
            "Download the video file to your device.",
          ],
  };
}

function buildAboutSection(sourceLabel) {
  return {
    title: `${sourceLabel} video download`,
    fromFormat: {
      name: `${sourceLabel} link`,
      fullName: `Supported ${sourceLabel} video link`,
      description: `A ${sourceLabel} URL that points to a supported video, page, or stream.`,
    },
    toFormat: {
      name: "Video file",
      fullName: "Downloadable video file",
      description: "A saved video file you can watch, keep, or share.",
    },
  };
}

function buildScreenshots(entry, title) {
  return asTextList(entry.screenshots).map((url) => ({
    url,
    alt: title,
    caption: title,
  }));
}

function permissionName(permission, index) {
  const explicitName = String(permission?.name ?? "").trim();
  if (explicitName) return explicitName;

  const description = String(permission?.description ?? "").toLowerCase();
  if (description.includes("host permissions")) return "Host permissions";
  if (
    description.includes("download content") ||
    description.includes("permission to save")
  ) {
    return "Responsible downloading";
  }
  if (description.includes("internet connection")) return "Internet access";
  return `Registry note ${index + 1}`;
}

function buildPermissionJustifications(entry) {
  const permissions = Array.isArray(entry.permissions) ? entry.permissions : [];
  const seen = new Map();

  return permissions
    .map((permission, index) => {
      const baseName = permissionName(permission, index);
      const count = seen.get(baseName) ?? 0;
      seen.set(baseName, count + 1);

      return {
        permission: count ? `${baseName} ${count + 1}` : baseName,
        justification: String(permission?.description ?? "").trim(),
      };
    })
    .filter((permission) => permission.permission && permission.justification);
}

function extractSerplyUrls(entry) {
  const serialized = JSON.stringify(entry);
  const matches = serialized.match(/https:\/\/serp\.ly\/[a-z0-9-]+/gi) ?? [];
  return matches.map((url) => url.replace(/[).,\]]+$/, ""));
}

async function checkUrl(url, redirectCount = 0) {
  if (!url || redirectCount > 8) return false;

  let response;
  try {
    response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; SERPRegistrySync/1.0)",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  } catch {
    return false;
  }

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    response.body?.cancel();
    return location
      ? checkUrl(new URL(location, url).toString(), redirectCount + 1)
      : false;
  }

  if (response.status === 404 || response.status === 410) {
    response.body?.cancel();
    return false;
  }

  if ([403, 405, 406, 429, 999].includes(response.status)) {
    response.body?.cancel();
    try {
      const getResponse = await fetch(url, {
        method: "GET",
        redirect: "manual",
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; SERPRegistrySync/1.0)",
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          range: "bytes=0-0",
        },
      });
      const ok = getResponse.ok;
      getResponse.body?.cancel();
      return ok;
    } catch {
      return false;
    }
  }

  response.body?.cancel();
  return response.ok;
}

export async function firstVerifiedUrl(candidates, verifyUrl = checkUrl) {
  for (const url of unique(candidates)) {
    if (await verifyUrl(url)) return url;
  }
  return "";
}

function buildExistingTokens(tools) {
  const tokens = new Map();

  for (const tool of tools.filter((entry) => entry.operation === "download")) {
    const candidates = [
      tool.id,
      tool.route,
      tool.name,
      tool.from,
      tool.presentationTitle,
      ...tool.outboundLinks.map((link) => link.url),
    ];

    for (const candidate of candidates.filter(Boolean)) {
      tokens.set(normalizeToken(candidate), tool.id);
    }

    const base = String(tool.id ?? "")
      .replace(/^download-/, "")
      .replace(/-videos$/, "")
      .replace(/-video-downloader$/, "")
      .replace(/-downloader$/, "");

    for (const candidate of [
      base,
      `${base}-downloader`,
      `${base}-video-downloader`,
      `${base}downloader`,
      `${base}videodownloader`,
    ]) {
      tokens.set(normalizeToken(candidate), tool.id);
    }
  }

  return tokens;
}

function registryMatchCandidates(entry, sourceSlug, id) {
  const shortTitle = String(entry.short_description ?? "")
    .replace(/^Download\s*&\s*Save\s*/i, "")
    .replace(/\s*Videos.*$/i, " Video Downloader");

  return [
    id,
    `/${id}`,
    entry.app_name,
    shortTitle,
    entry.serply_link,
    entry.serpx_link,
    sourceSlug,
    `${sourceSlug}-downloader`,
    `${sourceSlug}-video-downloader`,
  ];
}

function hasExistingTool(existingTokens, candidates) {
  return candidates
    .filter(Boolean)
    .some((candidate) => existingTokens.has(normalizeToken(candidate)));
}

function buildKeywords(sourceLabel, sourceSlug) {
  const lowerLabel = sourceLabel.toLowerCase();
  return unique([
    lowerLabel,
    sourceSlug,
    `${lowerLabel} downloader`,
    `${lowerLabel} video downloader`,
    `download ${lowerLabel} videos`,
    `${lowerLabel} mp4`,
    `${lowerLabel} browser extension`,
  ]);
}

async function buildTool(entry, repoSlug, verifyUrl) {
  const sourceSlug = sourceSlugFromRepoSlug(repoSlug);
  const id = `download-${sourceSlug}-videos`;
  const sourceLabel = sourceLabelFromEntry(entry, sourceSlug);
  const title = titleFromEntry(entry, sourceLabel);
  const description =
    String(entry.short_description ?? "").trim() ||
    `Download ${sourceLabel} videos for offline viewing. Fast ${sourceLabel} video downloader.`;
  const serplyUrl = await firstVerifiedUrl(
    [entry.serply_link, ...extractSerplyUrls(entry)],
    verifyUrl,
  );
  const screenshots = buildScreenshots(entry, title);
  const permissionJustifications = buildPermissionJustifications(entry);
  const productLinks = serplyUrl ? { serplyUrl } : undefined;
  const sourceLinks = serplyUrl
    ? [{ label: "Install extension", url: serplyUrl }]
    : undefined;

  const content = {
    tool: {
      title,
      subtitle: description,
      from: `${sourceLabel} link`,
      to: "Video file",
    },
    howTo: buildHowTo(entry, sourceLabel),
    infoArticle: buildInfoArticle(entry, sourceLabel),
    faqs: asFaqs(entry.faqs),
    aboutSection: buildAboutSection(sourceLabel),
    ...(productLinks ? { productLinks } : {}),
    ...(asTextList(entry.features).length
      ? { features: asTextList(entry.features) }
      : {}),
    ...(screenshots.length ? { screenshots } : {}),
    ...(sourceLinks ? { sourceLinks } : {}),
    supportedOperatingSystems: defaultOperatingSystems,
    supportedRegions: ["Worldwide"],
    ...(permissionJustifications.length ? { permissionJustifications } : {}),
    keywords: buildKeywords(sourceLabel, sourceSlug),
  };

  return {
    id,
    name: title,
    description,
    operation: "download",
    route: `/${id}`,
    from: sourceLabel,
    to: "mp4",
    isActive: true,
    tags: unique([
      sourceSlug,
      ...sourceSlug.split("-"),
      "video",
      "download",
      "downloader",
    ]),
    content,
    requiresFFmpeg: false,
  };
}

function escapeNonAscii(value) {
  return value.replace(/[^\x00-\x7F]/g, (character) => {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0xffff) {
      return `\\u${codePoint.toString(16).padStart(4, "0")}`;
    }

    const offset = codePoint - 0x10000;
    const high = 0xd800 + (offset >> 10);
    const low = 0xdc00 + (offset & 0x3ff);
    return `\\u${high.toString(16).padStart(4, "0")}\\u${low.toString(16).padStart(4, "0")}`;
  });
}

function insertTools(tools, newTools) {
  if (!newTools.length) return tools;
  const lastSourceDownloaderIndex = tools.reduce((lastIndex, tool, index) => {
    if (
      tool.operation === "download" &&
      /^download-[a-z0-9-]+-videos$/.test(tool.id)
    ) {
      return index;
    }
    return lastIndex;
  }, -1);

  const insertIndex =
    lastSourceDownloaderIndex >= 0
      ? lastSourceDownloaderIndex + 1
      : tools.length;

  return [
    ...tools.slice(0, insertIndex),
    ...newTools,
    ...tools.slice(insertIndex),
  ];
}

function validateRegistryAuthority(registry) {
  if (
    registry === null ||
    typeof registry !== "object" ||
    Array.isArray(registry) ||
    registry.overrides === null ||
    typeof registry.overrides !== "object" ||
    Array.isArray(registry.overrides)
  ) {
    throw new Error(
      "Downloader registry authority must contain an overrides object",
    );
  }
  for (const [key, entry] of Object.entries(registry.overrides)) {
    if (
      !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(key) ||
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      ![entry.app_name, entry.short_description].some(
        (value) => typeof value === "string" && value.trim().length > 0,
      )
    ) {
      throw new Error(
        "Downloader registry authority contains an invalid record",
      );
    }
  }
}

export async function planDownloaderRegistrySync({
  toolsSource,
  registry,
  verifyUrl = checkUrl,
}) {
  validateRegistryAuthority(registry);
  const tools = JSON.parse(toolsSource);
  if (!Array.isArray(tools)) {
    throw new Error("Owned Tool catalog must be an array");
  }
  const sourceCatalog = createOperationalToolCatalog(tools);
  const existingTokens = buildExistingTokens(sourceCatalog.tools);
  const existingIds = new Set(sourceCatalog.tools.map((tool) => tool.id));
  const newTools = [];

  for (const [key, entry] of Object.entries(registry.overrides ?? {})) {
    if (!isLiveRegistryEntry(entry)) continue;

    const repoSlug = key.split("/").pop();
    const sourceSlug = sourceSlugFromRepoSlug(repoSlug);
    const id = `download-${sourceSlug}-videos`;
    const candidates = registryMatchCandidates(entry, sourceSlug, id);

    if (existingIds.has(id) || hasExistingTool(existingTokens, candidates))
      continue;

    const tool = await buildTool(entry, repoSlug, verifyUrl);
    newTools.push(tool);
    existingIds.add(tool.id);
    existingTokens.set(normalizeToken(tool.id), tool.id);
    existingTokens.set(normalizeToken(tool.route), tool.id);
    existingTokens.set(normalizeToken(tool.name), tool.id);
    if (tool.content.productLinks?.serplyUrl) {
      existingTokens.set(
        normalizeToken(tool.content.productLinks.serplyUrl),
        tool.id,
      );
    }
  }

  if (!newTools.length) {
    return {
      newTools: [],
      nextToolsSource: toolsSource,
    };
  }

  const nextTools = insertTools(tools, newTools);
  createOperationalToolCatalog(nextTools);

  return {
    newTools,
    nextToolsSource: `${escapeNonAscii(JSON.stringify(nextTools, null, 2))}\n`,
  };
}
