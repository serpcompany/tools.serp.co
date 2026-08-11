import type { CatalogTool } from "@serp-tools/app-core/lib/tool-catalog";

export type SpecializedToolFamily =
  | "json-to-csv"
  | "csv-combiner"
  | "html-to-markdown"
  | "character-counter"
  | "pdf";

export type SpecializedPresentationRenderer = "specialized" | "pdf";

const familyDefinitions = Object.freeze([
  Object.freeze({
    family: "json-to-csv" as const,
    presentationRenderer: "specialized" as const,
    toolIds: Object.freeze(["json-to-csv"] as const),
  }),
  Object.freeze({
    family: "csv-combiner" as const,
    presentationRenderer: "specialized" as const,
    toolIds: Object.freeze(["csv-combiner"] as const),
  }),
  Object.freeze({
    family: "html-to-markdown" as const,
    presentationRenderer: "specialized" as const,
    toolIds: Object.freeze(["html-to-markdown"] as const),
  }),
  Object.freeze({
    family: "character-counter" as const,
    presentationRenderer: "specialized" as const,
    toolIds: Object.freeze(["character-counter"] as const),
  }),
  Object.freeze({
    family: "pdf" as const,
    presentationRenderer: "pdf" as const,
    toolIds: Object.freeze([
      "pdf-editor",
      "pdf-editor-extension",
      "pdf-editor-mac",
      "pdf-editor-windows",
      "pdf-reader",
      "pdf-reader-extension",
      "pdf-reader-mac",
      "pdf-reader-windows",
      "pdf-viewer",
      "pdf-viewer-extension",
      "pdf-viewer-windows",
    ] as const),
  }),
]);

export const SPECIALIZED_TOOL_IDS = Object.freeze(
  familyDefinitions.flatMap(({ toolIds }) => toolIds),
) as readonly string[];

export type SpecializedToolDefinition = Readonly<{
  toolId: string;
  family: SpecializedToolFamily;
  presentationRenderer: SpecializedPresentationRenderer;
}>;

const definitionByToolId = new Map<string, SpecializedToolDefinition>(
  familyDefinitions.flatMap(({ family, presentationRenderer, toolIds }) =>
    toolIds.map((toolId) => [
      toolId,
      Object.freeze({ toolId, family, presentationRenderer }),
    ] as const),
  ),
);

export function getSpecializedToolDefinition(
  toolId: string,
): SpecializedToolDefinition | undefined {
  return definitionByToolId.get(toolId);
}

export function getSpecializedPresentationRenderer(
  tool: CatalogTool,
): SpecializedPresentationRenderer | undefined {
  return definitionByToolId.get(tool.id)?.presentationRenderer;
}
