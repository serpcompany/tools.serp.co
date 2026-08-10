#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const DOCUMENTATION_INDEX = 'docs/README.md';
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.open-next',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'tmp',
]);
const RETIRED_CATEGORIES = ['docs/knowledge/', 'docs/planner/', 'docs/plans/'];
const RETIRED_CATEGORY_BASELINE = new Set([
  'docs/knowledge/adsense.md',
  'docs/knowledge/amr-audio-conversion.md',
  'docs/knowledge/apng-image-convert.md',
  'docs/knowledge/benchmark-transcribe-tools.md',
  'docs/knowledge/category-pages.md',
  'docs/knowledge/cloudflare-operations.md',
  'docs/knowledge/compression-pipeline.md',
  'docs/knowledge/dev-server-ports.md',
  'docs/knowledge/dev-server-postcss.md',
  'docs/knowledge/download-loom-videos.md',
  'docs/knowledge/downloader-ads.md',
  'docs/knowledge/downloader-page-requirements.md',
  'docs/knowledge/downloader-rate-limit.md',
  'docs/knowledge/ffmpeg-benchmark-2026-01-20.md',
  'docs/knowledge/fixtures-office.md',
  'docs/knowledge/image-canvas-grouping.md',
  'docs/knowledge/jsquash-webp-next-build.md',
  'docs/knowledge/lint-next-lint-deprecation.md',
  'docs/knowledge/pdf-viewer-editor.md',
  'docs/knowledge/server-action-rate-limit.md',
  'docs/knowledge/shared-site-footer.md',
  'docs/knowledge/tool-operation-taxonomy.md',
  'docs/knowledge/tools-link-hub.md',
  'docs/planner/README.md',
  'docs/planner/pdf-tools.md',
  'docs/plans/2026-05-17-adult-downloader-capability-testing-plan.md',
  'docs/plans/2026-05-17-adult-downloader-competitor-first-scale-plan.md',
  'docs/plans/2026-05-17-adult-downloader-scale-plan.md',
]);

function parseRoot(args) {
  const rootIndex = args.indexOf('--root');

  if (rootIndex === -1) {
    return process.cwd();
  }

  const root = args[rootIndex + 1];
  if (!root) {
    throw new Error('--root requires a directory');
  }

  return path.resolve(root);
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function findMarkdownFiles(root, directory = root) {
  const documents = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      documents.push(...findMarkdownFiles(root, absolutePath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      documents.push(toPosixPath(path.relative(root, absolutePath)));
    }
  }

  return documents.sort();
}

function markdownLinks(contents) {
  const links = [];
  const inlineLinkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  const referenceTargetPattern =
    /^[ \t]{0,3}\[([^\]]+)\]:[ \t]*(<[^>]+>|\S+)/gm;
  const referenceUsePattern = /!?\[([^\]]+)\]\[([^\]]*)\]/g;

  function normalizeTarget(rawTarget) {
    const target = rawTarget.trim();
    if (target.startsWith('<')) {
      const closingBracket = target.indexOf('>');
      if (closingBracket !== -1) {
        return target.slice(1, closingBracket);
      }
    }

    return target.replace(/\s+["'].*$/, '');
  }

  function lineAt(index) {
    return contents.slice(0, index).split(/\r?\n/).length;
  }

  function normalizeReferenceIdentifier(identifier) {
    return identifier.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  let match;
  while ((match = inlineLinkPattern.exec(contents)) !== null) {
    links.push({
      line: lineAt(match.index),
      target: normalizeTarget(match[1]),
    });
  }

  const definitions = new Map();
  while ((match = referenceTargetPattern.exec(contents)) !== null) {
    const identifier = normalizeReferenceIdentifier(match[1]);
    if (!definitions.has(identifier)) {
      definitions.set(identifier, {
        line: lineAt(match.index),
        target: normalizeTarget(match[2]),
      });
    }
  }

  const usedDefinitions = new Set();
  while ((match = referenceUsePattern.exec(contents)) !== null) {
    const identifier = normalizeReferenceIdentifier(match[2] || match[1]);
    const definition = definitions.get(identifier);
    if (definition && !usedDefinitions.has(identifier)) {
      usedDefinitions.add(identifier);
      links.push(definition);
    }
  }

  return links.sort((left, right) => left.line - right.line);
}

function isExternalLink(target) {
  return target.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(target);
}

function resolveInternalLink(root, source, target) {
  const fragmentIndex = target.indexOf('#');
  const targetPath = (
    fragmentIndex === -1 ? target : target.slice(0, fragmentIndex)
  ).split('?', 1)[0];
  const rawFragment =
    fragmentIndex === -1 ? null : target.slice(fragmentIndex + 1);

  let decodedTarget;
  let fragment;
  try {
    decodedTarget = decodeURIComponent(targetPath);
    fragment = rawFragment === null ? null : decodeURIComponent(rawFragment);
  } catch {
    decodedTarget = targetPath;
    fragment = rawFragment;
  }

  const absoluteTarget = !decodedTarget
    ? path.join(root, source)
    : decodedTarget.startsWith('/')
      ? path.join(root, decodedTarget.slice(1))
      : path.resolve(root, path.dirname(source), decodedTarget);
  const relativeTarget = path.relative(root, absoluteTarget);

  if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
    return { absoluteTarget, fragment, relativeTarget: null };
  }

  return {
    absoluteTarget,
    fragment,
    relativeTarget: toPosixPath(relativeTarget),
  };
}

function slugifyHeading(heading) {
  return heading
    .replace(/<[^>]*>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

function markdownAnchors(contents) {
  const anchors = new Set();
  const slugCounts = new Map();
  const headingPattern = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
  const explicitAnchorPattern =
    /<(?:a|[^>]+\s)(?:id|name)=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = headingPattern.exec(contents)) !== null) {
    const baseSlug = slugifyHeading(match[1]);
    const duplicateCount = slugCounts.get(baseSlug) ?? 0;
    const slug =
      duplicateCount === 0 ? baseSlug : `${baseSlug}-${duplicateCount}`;
    slugCounts.set(baseSlug, duplicateCount + 1);
    anchors.add(slug);
  }

  while ((match = explicitAnchorPattern.exec(contents)) !== null) {
    anchors.add(match[1]);
  }

  return anchors;
}

function report(diagnostic) {
  process.stderr.write(`${diagnostic}\n`);
  process.exitCode = 1;
}

const root = parseRoot(process.argv.slice(2));
const documents = findMarkdownFiles(root);
const indexPath = path.join(root, DOCUMENTATION_INDEX);
const indexedDocuments = new Set();
const anchorCache = new Map();

if (!existsSync(indexPath)) {
  report(
    `missing-document-index: ${DOCUMENTATION_INDEX} (create the durable documentation index)`,
  );
} else {
  const indexContents = readFileSync(indexPath, 'utf8');
  for (const { target } of markdownLinks(indexContents)) {
    if (isExternalLink(target)) {
      continue;
    }

    const resolved = resolveInternalLink(root, DOCUMENTATION_INDEX, target);
    if (resolved?.relativeTarget?.toLowerCase().endsWith('.md')) {
      indexedDocuments.add(resolved.relativeTarget);
    }
  }

  for (const document of documents) {
    if (document !== DOCUMENTATION_INDEX && !indexedDocuments.has(document)) {
      report(
        `unindexed-document: ${document} (add a Markdown link in ${DOCUMENTATION_INDEX})`,
      );
    }
  }
}

for (const document of documents) {
  if (
    RETIRED_CATEGORIES.some((category) => document.startsWith(category)) &&
    !RETIRED_CATEGORY_BASELINE.has(document)
  ) {
    report(
      `retired-document-category: ${document} (move current guidance to an owned runbook or package README; move dated evidence to docs/audits)`,
    );
  }

  const contents = readFileSync(path.join(root, document), 'utf8');
  for (const { line, target } of markdownLinks(contents)) {
    if (isExternalLink(target)) {
      continue;
    }

    const resolved = resolveInternalLink(root, document, target);
    if (resolved.relativeTarget === null) {
      report(
        `broken-link: ${document}:${line} -> ${target} (target leaves repository)`,
      );
      continue;
    }

    if (!existsSync(resolved.absoluteTarget)) {
      report(
        `broken-link: ${document}:${line} -> ${target} (target not found)`,
      );
      continue;
    }

    const targetIsDirectory = statSync(resolved.absoluteTarget).isDirectory();
    const markdownTarget = targetIsDirectory
      ? path.join(resolved.absoluteTarget, 'README.md')
      : resolved.absoluteTarget;

    if (targetIsDirectory && !existsSync(markdownTarget)) {
      report(
        `broken-link: ${document}:${line} -> ${target} (directory has no README.md)`,
      );
      continue;
    }

    if (resolved.fragment && markdownTarget.toLowerCase().endsWith('.md')) {
      let anchors = anchorCache.get(markdownTarget);
      if (!anchors) {
        anchors = markdownAnchors(readFileSync(markdownTarget, 'utf8'));
        anchorCache.set(markdownTarget, anchors);
      }

      if (!anchors.has(resolved.fragment)) {
        const relativeMarkdownTarget = toPosixPath(
          path.relative(root, markdownTarget),
        );
        report(
          `broken-link: ${document}:${line} -> ${target} (heading #${resolved.fragment} not found in ${relativeMarkdownTarget})`,
        );
      }
    }
  }
}
