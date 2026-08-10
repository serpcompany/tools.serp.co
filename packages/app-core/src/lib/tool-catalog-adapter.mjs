import { createRequire } from 'node:module';

import { TOOL_OPERATION_ORDER } from './tool-catalog-constants.mjs';

const require = createRequire(import.meta.url);
const registryData = require('../data/tools.json');

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record, field, location) {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${location}.${field} must be a non-empty string`);
  }
  return value;
}

function optionalString(record, field, location) {
  const value = record[field];
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(
      `${location}.${field} must be a non-empty string when provided`,
    );
  }
  return value;
}

function normalizeRoute(route, location) {
  if (
    !route.startsWith('/') ||
    route.startsWith('//') ||
    route === '/' ||
    /[?#\s]/.test(route)
  ) {
    throw new TypeError(`${location}.route must be a canonical absolute route`);
  }
  return `${route.replace(/\/+$/, '')}/`;
}

function outboundLinks(value, toolId, route, location) {
  if (value === undefined) return Object.freeze([]);
  if (!isRecord(value)) {
    throw new TypeError(`${location}.content must be an object when provided`);
  }
  const links = [];
  if (value.productLinks !== undefined) {
    if (!isRecord(value.productLinks)) {
      throw new TypeError(`${location}.content.productLinks must be an object`);
    }
    for (const [field, url] of Object.entries(value.productLinks)) {
      if (typeof url !== 'string' || url.trim() === '') {
        throw new TypeError(
          `${location}.content.productLinks.${field} must be a non-empty string`,
        );
      }
      links.push(Object.freeze({
        toolId,
        route,
        field: `content.productLinks.${field}`,
        label: field,
        url,
        kind: 'product',
      }));
    }
  }
  if (value.sourceLinks !== undefined) {
    if (!Array.isArray(value.sourceLinks)) {
      throw new TypeError(`${location}.content.sourceLinks must be an array`);
    }
    value.sourceLinks.forEach((link, index) => {
      if (!isRecord(link)) {
        throw new TypeError(
          `${location}.content.sourceLinks[${index}] must be an object`,
        );
      }
      const linkLocation = `${location}.content.sourceLinks[${index}]`;
      const label = requiredString(link, 'label', linkLocation);
      const url = requiredString(link, 'url', linkLocation);
      links.push(Object.freeze({
        toolId,
        route,
        field: `content.sourceLinks[${index}].url`,
        label,
        url,
        kind: 'source',
      }));
    });
  }
  return Object.freeze(links);
}

function presentationTitle(value, location) {
  if (value === undefined) return null;
  if (!isRecord(value)) {
    throw new TypeError(`${location}.content must be an object when provided`);
  }
  if (value.tool === undefined) return null;
  if (!isRecord(value.tool)) {
    throw new TypeError(`${location}.content.tool must be an object`);
  }
  return optionalString(value.tool, 'title', `${location}.content.tool`);
}

function normalizeTool(value, index) {
  const location = `registry[${index}]`;
  if (!isRecord(value)) {
    throw new TypeError(`${location} must be an object`);
  }
  const id = requiredString(value, 'id', location);
  const name = requiredString(value, 'name', location);
  const description = requiredString(value, 'description', location);
  const route = requiredString(value, 'route', location);
  const canonicalRoute = normalizeRoute(route, location);
  if (!TOOL_OPERATION_ORDER.includes(value.operation)) {
    throw new TypeError(`${location}.operation must be a supported Tool operation`);
  }
  if (typeof value.isActive !== 'boolean') {
    throw new TypeError(`${location}.isActive must be a boolean`);
  }

  return Object.freeze({
    id,
    name,
    description,
    operation: value.operation,
    route,
    canonicalRoute,
    isActive: value.isActive,
    from: optionalString(value, 'from', location),
    to: optionalString(value, 'to', location),
    requiresFFmpeg: value.requiresFFmpeg === true,
    presentationTitle: presentationTitle(value.content, location),
    outboundLinks: outboundLinks(value.content, id, route, location),
  });
}

export function createOperationalToolCatalog(registry) {
  if (!Array.isArray(registry)) {
    throw new TypeError('registry must be an array');
  }
  const tools = Object.freeze(registry.map(normalizeTool));
  const byId = new Map();
  const byRoute = new Map();
  for (const tool of tools) {
    if (byId.has(tool.id)) throw new TypeError(`duplicate Tool id: ${tool.id}`);
    if (byRoute.has(tool.canonicalRoute)) {
      throw new TypeError(`duplicate normalized route: ${tool.canonicalRoute}`);
    }
    byId.set(tool.id, tool);
    byRoute.set(tool.canonicalRoute, tool);
  }

  const activeTools = Object.freeze(tools.filter((tool) => tool.isActive));
  const categoryPaths = Object.freeze(
    TOOL_OPERATION_ORDER.filter((operation) =>
      activeTools.some((tool) => tool.operation === operation),
    ).map((operation) => `/category/${operation}/`),
  );
  const operationCounts = Object.freeze(
    Object.fromEntries(
      TOOL_OPERATION_ORDER.map((operation) => [
        operation,
        activeTools.filter((tool) => tool.operation === operation).length,
      ]).filter(([, count]) => count > 0),
    ),
  );

  return Object.freeze({
    tools,
    activeTools,
    categoryPaths,
    operationCounts,
  });
}

export const operationalToolCatalog = createOperationalToolCatalog(registryData);
