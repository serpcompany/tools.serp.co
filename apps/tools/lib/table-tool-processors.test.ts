import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

import { toolCatalog } from "../../../packages/app-core/src/lib/tool-catalog.ts";
import { getTableRendererToolIds } from "./table-convert-pages.ts";
import {
  tableInputContracts,
  tableOutputContracts,
  type TableInputFormat,
} from "./table-operation-policy.ts";
import { getToolProcessorAvailability } from "./tool-processor-registry.ts";
import {
  createTableOperationStateResolver,
  createTableToolWorkflow,
  getTableOperationState,
  type TableRasterizer,
  type TableWorkflowDeliveryPort,
} from "./table-tool-processors.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const XLSX_FIXTURE = new Uint8Array(
  readFileSync(new URL("./fixtures/table/people.xlsx", import.meta.url)),
);

const INPUT_FIXTURES: Readonly<Record<TableInputFormat, Uint8Array>> = {
  csv: encoder.encode("name,note\r\nAda,analytical engine\r\n"),
  excel: XLSX_FIXTURE,
  html: encoder.encode(
    "<table><tr><th>name</th><th>note</th></tr><tr><td>Ada</td><td>analytical engine</td></tr></table>",
  ),
  json: encoder.encode('[{"name":"Ada","note":"analytical engine"}]'),
  latex: encoder.encode(String.raw`\begin{tabular}{ll}
name & note \\
\hline
Ada & analytical engine \\
\end{tabular}
`),
  markdown: encoder.encode(
    "| name | note |\n| --- | --- |\n| Ada | analytical engine |\n",
  ),
  mediawiki: encoder.encode(
    '{| class="wikitable"\n! name !! note\n|-\n| Ada || analytical engine\n|}\n',
  ),
  mysql: encoder.encode(
    "INSERT INTO `people` (`name`, `note`) VALUES ('Ada', 'analytical engine');",
  ),
  sql: encoder.encode(
    "INSERT INTO people (name, note) VALUES ('Ada', 'analytical engine');",
  ),
  xml: encoder.encode(
    "<rows><row><name>Ada</name><note>analytical engine</note></row></rows>",
  ),
  yaml: encoder.encode("- name: Ada\n  note: analytical engine\n"),
};

function createRecordingWorkflow(rasterize?: TableRasterizer) {
  const deliveries: Parameters<TableWorkflowDeliveryPort>[0][] = [];
  const workflow = createTableToolWorkflow({
    deliver: async (media) => {
      deliveries.push(media);
      return `delivery-${deliveries.length}`;
    },
    telemetry: {
      start: async () => {},
      terminal: async () => {},
    },
    nextId: (() => {
      let id = 0;
      return (kind) => `${kind}-${++id}`;
    })(),
    rasterize,
    verifyRaster: rasterize
      ? async (bytes, format) => {
          const metadata = await sharp(bytes).metadata();
          if (
            metadata.format !== format ||
            !metadata.width ||
            !metadata.height
          ) {
            throw new TypeError(`${format} fixture did not decode`);
          }
        }
      : undefined,
  });
  return { deliveries, workflow };
}

const sharpRasterizer: TableRasterizer = async (table, format) => {
  const text = [table.headers, ...table.rows]
    .map(
      (row, index) =>
        `<text x="8" y="${24 + index * 24}" font-size="14">${row.join(" | ")}</text>`,
    )
    .join("");
  const image = sharp(
    Buffer.from(
      `<svg width="640" height="${(table.rows.length + 2) * 24}">${text}</svg>`,
    ),
  );
  return new Uint8Array(
    await (format === "png" ? image.png() : image.jpeg()).toBuffer(),
  );
};

test("every active table Tool id has one explicit processor state", () => {
  const toolIds = getTableRendererToolIds();
  const states = toolIds.map(getTableOperationState);

  assert.equal(toolIds.length, 139);
  assert.equal(new Set(states.map(({ toolId }) => toolId)).size, 139);
  assert.deepEqual(
    Object.fromEntries(
      ["supported", "unsupported", "unknown"].map((kind) => [
        kind,
        states.filter((entry) => entry.kind === kind).length,
      ]),
    ),
    { supported: 93, unsupported: 46, unknown: 0 },
  );

  assert.deepEqual(getTableOperationState("csv-to-json"), {
    kind: "supported",
    toolId: "csv-to-json",
    adapterId: "browser-table-converter",
    from: "csv",
    to: "json",
  });
  assert.deepEqual(getTableOperationState("csv-to-avro"), {
    kind: "unsupported",
    toolId: "csv-to-avro",
    reason:
      "AVRO output has no maintained browser serializer and semantic validator in this repository.",
    sourceNeeded:
      "Adopt a maintained browser serializer and validate the emitted AVRO document before enabling this Tool.",
  });

  const activeTableTools = toolCatalog.activeTools.filter(
    (tool) => tool.content?.tool.renderer === "table",
  );
  assert.deepEqual(
    activeTableTools.map(({ id }) => id),
    toolIds,
  );
  for (const state of states) {
    assert.equal(
      getToolProcessorAvailability(state.toolId).kind,
      state.kind === "supported" ? "wired" : "unwired",
      state.toolId,
    );
  }
});

test("every supported table Tool id resolves and succeeds through workflow.run", async () => {
  const states = getTableRendererToolIds()
    .map(getTableOperationState)
    .filter((state) => state.kind === "supported");
  assert.equal(states.length, 93);

  for (const state of states) {
    const { deliveries, workflow } = createRecordingWorkflow(sharpRasterizer);
    const inputContract = tableInputContracts[state.from];
    const outcome = await workflow.run({
      toolId: state.toolId,
      input: {
        kind: "file",
        media: {
          name: `people.${state.from === "excel" ? "xlsx" : state.from}`,
          format: state.from,
          mimeType: inputContract.mimeTypes[0]!,
          bytes: INPUT_FIXTURES[state.from],
        },
      },
    });

    assert.equal(
      outcome.status,
      "succeeded",
      outcome.status === "failed"
        ? `${state.toolId}: ${outcome.error.code}: ${outcome.error.message}`
        : state.toolId,
    );
    assert.equal(deliveries.length, 1, state.toolId);
  }
});

test("eligible output policy cannot imply support without a resolvable processor", () => {
  const resolveState = createTableOperationStateResolver(() => undefined);

  assert.deepEqual(resolveState("csv-to-json"), {
    kind: "unknown",
    toolId: "csv-to-json",
    reason: "The table output policy is eligible but no processor resolves.",
    sourceNeeded:
      "Register and test an exact processor before classifying this operation as supported.",
  });
  assert.equal(getToolProcessorAvailability("csv-to-json").kind, "wired");
});

test("every supported table codec names maintained ownership or repository rationale", () => {
  const codecs = [
    ...Object.values(tableInputContracts).map(({ parser }) => parser),
    ...Object.values(tableOutputContracts).map(({ serializer }) => serializer),
  ];
  for (const codec of codecs) {
    assert.ok(codec.identity);
    if (codec.class === "repository-authored") {
      assert.ok(codec.rationale.length > 80, codec.identity);
    } else {
      assert.match(codec.class, /^(library|platform-primitive)$/);
    }
  }
});

test("workflow.run parses quoted CSV and delivers schema-preserving JSON", async () => {
  const { deliveries, workflow } = createRecordingWorkflow();
  const phases: string[] = [];

  const outcome = await workflow.run(
    {
      toolId: "csv-to-json",
      input: {
        kind: "file",
        media: {
          name: "people.csv",
          format: "csv",
          mimeType: "text/csv",
          bytes: encoder.encode(
            'name,notes\r\nAda,"comma, preserved"\r\nGrace,"line one\nline two"\r\n',
          ),
        },
      },
    },
    { observe: ({ phase }) => phases.push(phase) },
  );

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(phases, [
    "acquiring",
    "processing",
    "validating",
    "delivering",
    "succeeded",
  ]);
  assert.equal(deliveries.length, 1);
  assert.deepEqual(JSON.parse(decoder.decode(deliveries[0]?.bytes)), [
    { name: "Ada", notes: "comma, preserved" },
    { name: "Grace", notes: "line one\nline two" },
  ]);
});

test("workflow.run serializes YAML rows as parseable delimiter-safe CSV", async () => {
  const { deliveries, workflow } = createRecordingWorkflow();

  const outcome = await workflow.run({
    toolId: "yaml-to-csv",
    input: {
      kind: "file",
      media: {
        name: "people.yaml",
        format: "yaml",
        mimeType: "application/yaml",
        bytes: encoder.encode(
          '- name: Ada\n  note: "comma, preserved"\n- name: Grace\n  note: \'quote " preserved\'\n',
        ),
      },
    },
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(
    decoder.decode(deliveries[0]?.bytes),
    'name,note\r\nAda,"comma, preserved"\r\nGrace,"quote "" preserved"',
  );
});

test("workflow.run parses an HTML table and preserves its row schema", async () => {
  const { deliveries, workflow } = createRecordingWorkflow();

  const outcome = await workflow.run({
    toolId: "html-to-json",
    input: {
      kind: "file",
      media: {
        name: "people.html",
        format: "html",
        mimeType: "text/html",
        bytes: encoder.encode(
          "<table><thead><tr><th>name</th><th>note</th></tr></thead>" +
            "<tbody><tr><td>Ada</td><td>one &amp; two</td></tr></tbody></table>",
        ),
      },
    },
  });

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(JSON.parse(decoder.decode(deliveries[0]?.bytes)), [
    { name: "Ada", note: "one & two" },
  ]);
});

test("workflow.run parses SQL INSERT tuples without losing quoted delimiters", async () => {
  const { deliveries, workflow } = createRecordingWorkflow();

  const outcome = await workflow.run({
    toolId: "sql-to-json",
    input: {
      kind: "file",
      media: {
        name: "people.sql",
        format: "sql",
        mimeType: "application/sql",
        bytes: encoder.encode(
          "INSERT INTO people (name, note) VALUES ('Ada', 'one, two'), ('Grace', 'compiler''s pioneer');",
        ),
      },
    },
  });

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(JSON.parse(decoder.decode(deliveries[0]?.bytes)), [
    { name: "Ada", note: "one, two" },
    { name: "Grace", note: "compiler's pioneer" },
  ]);
});

test("workflow.run emits quoted SQL identifiers and escaped string literals", async () => {
  const { deliveries, workflow } = createRecordingWorkflow();
  const outcome = await workflow.run({
    toolId: "json-to-sql",
    input: {
      kind: "file",
      media: {
        name: "people.json",
        format: "json",
        mimeType: "application/json",
        bytes: encoder.encode(
          JSON.stringify([{ "first name": "Ada", note: "O'Reilly" }]),
        ),
      },
    },
  });

  assert.equal(outcome.status, "succeeded");
  assert.match(
    decoder.decode(deliveries[0]?.bytes),
    /\("first name", "note"\)/,
  );
  assert.match(decoder.decode(deliveries[0]?.bytes), /'O''Reilly'/);
});

test("workflow.run parses an independently generated XLSX workbook", async () => {
  const { deliveries, workflow } = createRecordingWorkflow();

  const outcome = await workflow.run({
    toolId: "excel-to-json",
    input: {
      kind: "file",
      media: {
        name: "people.xlsx",
        format: "excel",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes: XLSX_FIXTURE,
      },
    },
  });

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(JSON.parse(decoder.decode(deliveries[0]?.bytes)), [
    { name: "Ada", note: "comma, preserved" },
    { name: "Grace", note: "compiler pioneer" },
  ]);
});

test("workflow.run emits a parseable XLSX workbook with preserved cells", async () => {
  const first = createRecordingWorkflow();
  const excelOutcome = await first.workflow.run({
    toolId: "csv-to-excel",
    input: {
      kind: "file",
      media: {
        name: "people.csv",
        format: "csv",
        mimeType: "text/csv",
        bytes: encoder.encode("name,note\r\nAda,analytical engine\r\n"),
      },
    },
  });
  assert.equal(excelOutcome.status, "succeeded");

  const second = createRecordingWorkflow();
  const jsonOutcome = await second.workflow.run({
    toolId: "excel-to-json",
    input: {
      kind: "file",
      media: {
        name: "people.xlsx",
        format: "excel",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes: first.deliveries[0]?.bytes ?? new Uint8Array(),
      },
    },
  });
  assert.equal(jsonOutcome.status, "succeeded");
  assert.deepEqual(JSON.parse(decoder.decode(second.deliveries[0]?.bytes)), [
    { name: "Ada", note: "analytical engine" },
  ]);
});

test("workflow.run emits a loadable PDF document with at least one page", async () => {
  const { deliveries, workflow } = createRecordingWorkflow();
  const outcome = await workflow.run({
    toolId: "csv-to-pdf",
    input: {
      kind: "file",
      media: {
        name: "people.csv",
        format: "csv",
        mimeType: "text/csv",
        bytes: encoder.encode("name,note\r\nAda,analytical engine\r\n"),
      },
    },
  });

  assert.equal(outcome.status, "succeeded");
  const document = await PDFDocument.load(
    deliveries[0]?.bytes ?? new Uint8Array(),
  );
  assert.equal(document.getPageCount(), 1);
});

test("workflow.run emits decodable PNG and JPEG table images", async () => {
  const png = createRecordingWorkflow(sharpRasterizer);
  const pngOutcome = await png.workflow.run({
    toolId: "csv-to-png",
    input: {
      kind: "file",
      media: {
        name: "people.csv",
        format: "csv",
        mimeType: "text/csv",
        bytes: encoder.encode("name,note\r\nAda,analytical engine\r\n"),
      },
    },
  });
  assert.equal(pngOutcome.status, "succeeded");
  assert.deepEqual(
    await sharp(png.deliveries[0]?.bytes)
      .metadata()
      .then(({ format, width, height }) => ({
        format,
        width,
        height,
      })),
    { format: "png", width: 640, height: 72 },
  );

  const jpeg = createRecordingWorkflow(sharpRasterizer);
  const jpegOutcome = await jpeg.workflow.run({
    toolId: "markdown-to-jpeg",
    input: {
      kind: "file",
      media: {
        name: "people.md",
        format: "markdown",
        mimeType: "text/markdown",
        bytes: encoder.encode(
          "| name | note |\n| --- | --- |\n| Ada | analytical engine |\n",
        ),
      },
    },
  });
  assert.equal(jpegOutcome.status, "succeeded");
  assert.equal(
    (await sharp(jpeg.deliveries[0]?.bytes).metadata()).format,
    "jpeg",
  );
});

test("unsupported and unknown table operations fail closed before telemetry or delivery", async () => {
  for (const toolId of ["csv-to-avro", "csv-to-not-a-format"]) {
    const { deliveries, workflow } = createRecordingWorkflow();
    const outcome = await workflow.run({
      toolId,
      input: {
        kind: "file",
        media: {
          name: "people.csv",
          format: "csv",
          mimeType: "text/csv",
          bytes: encoder.encode("name\r\nAda\r\n"),
        },
      },
    });

    assert.equal(outcome.status, "failed", toolId);
    if (outcome.status === "failed") {
      assert.equal(outcome.error.code, "unsupported-tool", toolId);
      assert.deepEqual(outcome.telemetry, {
        start: "not-attempted",
        terminal: "not-attempted",
      });
    }
    assert.equal(deliveries.length, 0, toolId);
  }
});

test("workflow.run rejects malformed row and document invariants before processing", async () => {
  const invalidCases = [
    {
      toolId: "csv-to-json",
      format: "csv",
      mimeType: "text/csv",
      bytes: encoder.encode("name,note\r\n"),
    },
    {
      toolId: "csv-to-json",
      format: "csv",
      mimeType: "text/csv",
      bytes: encoder.encode("name,note\r\nAda\r\n"),
    },
    {
      toolId: "xml-to-csv",
      format: "xml",
      mimeType: "application/xml",
      bytes: encoder.encode("<rows><row><name>Ada</row></rows>"),
    },
    {
      toolId: "xml-to-csv",
      format: "xml",
      mimeType: "application/xml",
      bytes: encoder.encode(
        "<rows><row><name>Ada</name><note>engine</note></row><row><name>Grace</name></row></rows>",
      ),
    },
    {
      toolId: "mediawiki-to-csv",
      format: "mediawiki",
      mimeType: "text/plain",
      bytes: encoder.encode("! name !! note\n| Ada || engine"),
    },
  ];

  for (const invalid of invalidCases) {
    const { deliveries, workflow } = createRecordingWorkflow();
    const outcome = await workflow.run({
      toolId: invalid.toolId,
      input: {
        kind: "file",
        media: {
          name: `invalid.${invalid.format}`,
          format: invalid.format,
          mimeType: invalid.mimeType,
          bytes: invalid.bytes,
        },
      },
    });
    assert.equal(outcome.status, "failed", invalid.toolId);
    if (outcome.status === "failed") {
      assert.equal(outcome.error.code, "invalid-request", invalid.toolId);
      assert.equal(outcome.telemetry.start, "not-attempted", invalid.toolId);
    }
    assert.equal(deliveries.length, 0, invalid.toolId);
  }
});

test("table presentation delegates execution, terminal telemetry, and delivery policy", () => {
  const presentation = readFileSync(
    new URL("../components/TableConvertDemo.tsx", import.meta.url),
    "utf8",
  );
  const browserAdapter = readFileSync(
    new URL("./table-browser-workflow.ts", import.meta.url),
    "utf8",
  );

  assert.match(presentation, /workflow\.run\(/);
  assert.match(presentation, /deliveries\.download\(/);
  assert.doesNotMatch(
    presentation,
    /beginToolRun|saveBlob|finishSuccess|finishFailure/,
  );
  assert.match(browserAdapter, /beginToolRun/);
  assert.match(browserAdapter, /finishSuccess/);
  assert.match(browserAdapter, /finishFailure/);
  assert.match(browserAdapter, /URL\.createObjectURL/);
});
