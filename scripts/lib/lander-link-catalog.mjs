function normalizeText(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function hostnameWithoutWww(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isSourceSiteLink(tool, link) {
  if (tool.operation !== 'download') return false;
  const from = normalizeText(tool.from);
  if (!from) return false;
  const label = normalizeText(link.label);
  const host = normalizeText(hostnameWithoutWww(link.url).split('.')[0]);
  return label === from || host === from;
}

export function collectCatalogLanderLinks(tools) {
  return tools.flatMap((tool) =>
    tool.outboundLinks
      .filter((link) => /^https?:\/\//i.test(link.url))
      .map((link) => ({
        ...link,
        ...(link.kind === 'source'
          ? { sourceSiteViolation: isSourceSiteLink(tool, link) }
          : {}),
      })),
  );
}
