// Reading Office Open XML packages (issue #265): the ZIP parts, their
// relationships and a small XML scanner, shared by xlsx-sheets.ts and
// pptx-slides.ts. A part is inflated only when it's asked for and only up to
// the size its ZIP entry declares, so a ZIP bomb can't fill the tab's memory.

import { unzipSync } from "fflate";

const XML_TOKEN =
  /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|([^<]+)/g;
const XML_ATTRIBUTE = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITY = /&(?:#(\d+)|#x([0-9a-fA-F]+)|(lt|gt|amp|quot|apos));/g;
const NAMED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(ENTITY, (whole, decimal?: string, hex?: string, name?: string) => {
    if (name) return NAMED[name] ?? whole;
    const code = decimal ? Number(decimal) : parseInt(hex!, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

const localName = (name: string) => name.slice(name.indexOf(":") + 1);

type XmlHandlers = {
  open?: (name: string, attributes: Record<string, string>, selfClosing: boolean) => void;
  close?: (name: string) => void;
  text?: (text: string) => void;
};

// Calls back for each element and text run, with local names (a prefix
// such as "x:" dropped) and attributes decoded.
export function scanXml(xml: string, { open, close, text }: XmlHandlers): void {
  const tokens = new RegExp(XML_TOKEN.source, "g");
  const attributePairs = new RegExp(XML_ATTRIBUTE.source, "g");
  for (let match = tokens.exec(xml); match; match = tokens.exec(xml)) {
    const [, slash, name, attributeText, selfClosing, cdata, run] = match;
    if (name !== undefined) {
      const local = localName(name);
      if (slash) {
        close?.(local);
        continue;
      }
      const attributes: Record<string, string> = {};
      if (open && attributeText) {
        attributePairs.lastIndex = 0;
        for (let pair = attributePairs.exec(attributeText); pair; pair = attributePairs.exec(attributeText)) {
          attributes[localName(pair[1]!)] = decodeEntities(pair[2] ?? pair[3] ?? "");
        }
      }
      open?.(local, attributes, Boolean(selfClosing));
      if (selfClosing) close?.(local);
    } else if (cdata !== undefined) {
      text?.(cdata);
    } else if (run !== undefined) {
      text?.(decodeEntities(run));
    }
  }
}

// ------------------------------------------------------------ packages --

// A part's relationships: id to target part path and type.
export function parseRelationships(xml: string, partPath: string): Map<string, { target: string; type: string }> {
  const base = partPath.slice(0, partPath.lastIndexOf("/") + 1);
  const relationships = new Map<string, { target: string; type: string }>();
  scanXml(xml, {
    open(name, attributes) {
      if (name !== "Relationship" || attributes.TargetMode === "External") return;
      relationships.set(attributes.Id ?? "", { target: resolvePart(base, attributes.Target ?? ""), type: attributes.Type ?? "" });
    },
  });
  return relationships;
}

// A relationship's target as a path in the ZIP: relative to the part's
// folder, or from the root when it starts with "/".
export function resolvePart(base: string, target: string): string {
  const segments = (target.startsWith("/") ? target.slice(1) : base + target).split("/");
  const parts: string[] = [];
  for (const segment of segments) {
    if (segment === "..") parts.pop();
    else if (segment && segment !== ".") parts.push(segment);
  }
  return parts.join("/");
}

// The relationships part of `partPath`: xl/workbook.xml's is
// xl/_rels/workbook.xml.rels.
export function relationshipsPath(partPath: string): string {
  const slash = partPath.lastIndexOf("/");
  return `${partPath.slice(0, slash + 1)}_rels/${partPath.slice(slash + 1)}.rels`;
}

const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

// An OLE compound file: an Office 97-2003 file, or an Office file saved
// with a password (its package encrypted inside one).
export function isOleFile(bytes: Uint8Array): boolean {
  return OLE_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

export const isZipFile = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b;

// Every entry's name and the size it declares once inflated, without
// inflating any.
export function listParts(bytes: Uint8Array): { name: string; size: number }[] {
  const entries: { name: string; size: number }[] = [];
  unzipSync(bytes, {
    filter: (file) => {
      entries.push({ name: file.name, size: file.originalSize });
      return false;
    },
  });
  return entries;
}

// The parts `wanted` picks, inflated. Throws `tooBig` when one declares more
// than `maxBytes`, and says the file isn't a complete ZIP archive when it
// can't be read.
export type ReadOptions = { maxBytes: number; tooBig: string; kind: string };

export function readParts(
  bytes: Uint8Array,
  wanted: (name: string) => boolean,
  { maxBytes, tooBig, kind }: ReadOptions,
): Record<string, Uint8Array> {
  let large = false;
  let parts: Record<string, Uint8Array>;
  try {
    parts = unzipSync(bytes, {
      filter: (file) => {
        if (!wanted(file.name)) return false;
        if (file.originalSize > maxBytes) large = true;
        return !large;
      },
    });
  } catch {
    throw new Error(`This ${kind} couldn't be read: it isn't a complete ZIP archive.`);
  }
  if (large) throw new Error(tooBig);
  return parts;
}

export const partText = (bytes: Uint8Array | undefined) => (bytes ? new TextDecoder().decode(bytes) : "");

// The package's main part (xl/workbook.xml, ppt/presentation.xml), from its
// root relationships.
export function mainPartPath(bytes: Uint8Array, fallback: string, read: ReadOptions): string {
  const root = readParts(bytes, (name) => name === "_rels/.rels", read);
  const office = [...parseRelationships(partText(root["_rels/.rels"]), "").values()].find((relation) =>
    relation.type.endsWith("/officeDocument"),
  );
  return office?.target || fallback;
}
