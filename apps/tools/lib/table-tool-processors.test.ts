import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PDFDocument, StandardFonts } from "pdf-lib";

import { toolCatalog } from "../../../packages/app-core/src/lib/tool-catalog.ts";
import {
  detectFormatFromFile,
  getPlaceholder,
} from "../components/table-convert/formats.ts";
import { getTableRendererToolIds } from "./table-convert-pages.ts";
import {
  createBrowserTableWorkflow,
  createLatestFileReader,
} from "./table-browser-workflow.ts";
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
  parseTableInput,
  serializeTableInputText,
  verifyTablePdfOutput,
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

function createRecordingWorkflow() {
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
  });
  return { deliveries, workflow };
}

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
    { supported: 80, unsupported: 59, unknown: 0 },
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
  assert.equal(states.length, 80);

  for (const state of states) {
    const { deliveries, workflow } = createRecordingWorkflow();
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

test("single-column CSV and singleton XML cells round-trip without widening schema", async () => {
  const csv = createRecordingWorkflow();
  const csvOutcome = await csv.workflow.run({
    toolId: "csv-to-json",
    input: {
      kind: "file",
      media: {
        name: "names.csv",
        format: "csv",
        mimeType: "text/csv",
        bytes: encoder.encode("name\nAda\n"),
      },
    },
  });
  assert.equal(csvOutcome.status, "succeeded");
  assert.deepEqual(JSON.parse(decoder.decode(csv.deliveries[0]?.bytes)), [
    { name: "Ada" },
  ]);

  const xml = createRecordingWorkflow();
  const xmlOutcome = await xml.workflow.run({
    toolId: "json-to-xml",
    input: {
      kind: "file",
      media: {
        name: "names.json",
        format: "json",
        mimeType: "application/json",
        bytes: encoder.encode('[{"name":"Ada"}]'),
      },
    },
  });
  assert.equal(xmlOutcome.status, "succeeded");
  assert.equal(xml.deliveries.length, 1);

  const reparsed = createRecordingWorkflow();
  const reparseOutcome = await reparsed.workflow.run({
    toolId: "xml-to-csv",
    input: {
      kind: "file",
      media: {
        name: "names.xml",
        format: "xml",
        mimeType: "application/xml",
        bytes: xml.deliveries[0]?.bytes ?? new Uint8Array(),
      },
    },
  });
  assert.equal(
    reparseOutcome.status,
    "succeeded",
    reparseOutcome.status === "failed"
      ? `${reparseOutcome.error.code}: ${reparseOutcome.error.message}`
      : reparseOutcome.status,
  );
  assert.equal(decoder.decode(reparsed.deliveries[0]?.bytes), "name\r\nAda");
});

test("CSV preserves explicit empty records while ignoring blank physical lines", async () => {
  const singleColumn = createRecordingWorkflow();
  const singleOutcome = await singleColumn.workflow.run({
    toolId: "csv-to-json",
    input: {
      kind: "file",
      media: {
        name: "names.csv",
        format: "csv",
        mimeType: "text/csv",
        bytes: encoder.encode('name\r\nAda\r\n\r\n""\r\nGrace\r\n'),
      },
    },
  });
  assert.equal(singleOutcome.status, "succeeded");
  assert.deepEqual(
    JSON.parse(decoder.decode(singleColumn.deliveries[0]?.bytes)),
    [{ name: "Ada" }, { name: "" }, { name: "Grace" }],
  );

  const multiColumn = createRecordingWorkflow();
  const multiOutcome = await multiColumn.workflow.run({
    toolId: "csv-to-json",
    input: {
      kind: "file",
      media: {
        name: "people.csv",
        format: "csv",
        mimeType: "text/csv",
        bytes: encoder.encode("name,note\nAda,engine\n\n,\nGrace,compiler\n"),
      },
    },
  });
  assert.equal(multiOutcome.status, "succeeded");
  const records = JSON.parse(decoder.decode(multiColumn.deliveries[0]?.bytes));
  assert.equal(records.length, 3);
  assert.deepEqual(records[1], { name: "", note: "" });

  const serialized = await serializeTableInputText("csv", {
    headers: ["name"],
    rows: [["Ada"], [""], ["Grace"]],
  });
  assert.deepEqual(await parseTableInput("csv", encoder.encode(serialized)), {
    headers: ["name"],
    rows: [["Ada"], [""], ["Grace"]],
  });
  assert.deepEqual(
    await parseTableInput("csv", encoder.encode('name\rAda\r\r""\rGrace\r')),
    {
      headers: ["name"],
      rows: [["Ada"], [""], ["Grace"]],
    },
  );
  assert.deepEqual(
    await parseTableInput("csv", encoder.encode('name\nfoo"bar\n\nbaz\n')),
    {
      headers: ["name"],
      rows: [['foo"bar'], ["baz"]],
    },
  );
});

test("Excel upload claims only the OOXML workbook format the processor accepts", () => {
  assert.equal(
    detectFormatFromFile({
      name: "legacy.xls",
      type: "application/vnd.ms-excel",
    } as File),
    null,
  );
  assert.equal(
    detectFormatFromFile({
      name: "workbook.xlsx",
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    } as File),
    "excel",
  );
  assert.equal(getPlaceholder("excel"), "Upload an Excel file (.xlsx)");
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

test("Markdown preserves ordinary and trailing backslashes while unescaping pipes", async () => {
  const { deliveries, workflow } = createRecordingWorkflow();
  const markdownBytes = encoder.encode(
    String.raw`| path | trailing | delimiter |
| --- | --- | --- |
| C:\temp\file | slash\\ | pipe\|kept |
| D:\docs | end\\ | pipe\|
`,
  );
  const outcome = await workflow.run({
    toolId: "markdown-to-json",
    input: {
      kind: "file",
      media: {
        name: "paths.md",
        format: "markdown",
        mimeType: "text/markdown",
        bytes: markdownBytes,
      },
    },
  });

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(JSON.parse(decoder.decode(deliveries[0]?.bytes)), [
    {
      path: String.raw`C:\temp\file`,
      trailing: "slash\\",
      delimiter: "pipe|kept",
    },
    {
      path: String.raw`D:\docs`,
      trailing: "end\\",
      delimiter: "pipe|",
    },
  ]);
  assert.deepEqual(await parseTableInput("markdown", markdownBytes), {
    headers: ["path", "trailing", "delimiter"],
    rows: [
      [String.raw`C:\temp\file`, "slash\\", "pipe|kept"],
      [String.raw`D:\docs`, "end\\", "pipe|"],
    ],
  });
  const serialized = await serializeTableInputText("markdown", {
    headers: ["path", "trailing", "delimiter"],
    rows: [[String.raw`C:\temp\file`, "slash\\", "pipe|"]],
  });
  assert.deepEqual(
    await parseTableInput("markdown", encoder.encode(serialized)),
    {
      headers: ["path", "trailing", "delimiter"],
      rows: [[String.raw`C:\temp\file`, "slash\\", "pipe|"]],
    },
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

test("SQL and MySQL reject tokens before or after the single INSERT statement", async () => {
  const adversarial = [
    "DROP TABLE audit; INSERT INTO people (name) VALUES ('Ada');",
    "INSERT INTO people (name) VALUES ('Ada'); DROP TABLE audit;",
  ];

  for (const toolId of ["sql-to-json", "mysql-to-json"]) {
    for (const statement of adversarial) {
      const { deliveries, workflow } = createRecordingWorkflow();
      const format = toolId.startsWith("mysql") ? "mysql" : "sql";
      const outcome = await workflow.run({
        toolId,
        input: {
          kind: "file",
          media: {
            name: `people.${format}`,
            format,
            mimeType: "application/sql",
            bytes: encoder.encode(statement),
          },
        },
      });

      assert.equal(outcome.status, "failed", `${toolId}: ${statement}`);
      if (outcome.status === "failed") {
        assert.equal(outcome.error.code, "invalid-request");
        assert.equal(outcome.telemetry.start, "not-attempted");
      }
      assert.equal(deliveries.length, 0);
    }
  }
});

test("SQL and MySQL accept only bounded literal VALUES without changing their table meaning", async () => {
  const validStatement =
    "INSERT INTO people (text, empty, truthy, falsy, integer, decimal, exponent) " +
    "VALUES ('O''Reilly', NULL, TRUE, false, -42, +3.50, 6.02e23);";

  for (const toolId of ["sql-to-json", "mysql-to-json"]) {
    const format = toolId.startsWith("mysql") ? "mysql" : "sql";
    const { deliveries, workflow } = createRecordingWorkflow();
    const outcome = await workflow.run({
      toolId,
      input: {
        kind: "file",
        media: {
          name: `literals.${format}`,
          format,
          mimeType: "application/sql",
          bytes: encoder.encode(validStatement),
        },
      },
    });

    assert.equal(outcome.status, "succeeded", toolId);
    assert.deepEqual(JSON.parse(decoder.decode(deliveries[0]?.bytes)), [
      {
        text: "O'Reilly",
        empty: "",
        truthy: "true",
        falsy: "false",
        integer: "-42",
        decimal: "+3.50",
        exponent: "6.02e23",
      },
    ]);
  }
});

test("SQL and MySQL reject non-literal VALUES before telemetry or delivery", async () => {
  const invalidValues = [
    "1 + 2",
    "DEFAULT",
    "CURRENT_TIMESTAMP",
    "-- comment\n7",
    "/* comment */ 7",
    "1e",
    "+",
    ".",
    "0x10",
    "'closed' suffix",
  ];

  for (const toolId of ["sql-to-json", "mysql-to-json"]) {
    const format = toolId.startsWith("mysql") ? "mysql" : "sql";
    for (const value of invalidValues) {
      const { deliveries, workflow } = createRecordingWorkflow();
      const outcome = await workflow.run({
        toolId,
        input: {
          kind: "file",
          media: {
            name: `invalid.${format}`,
            format,
            mimeType: "application/sql",
            bytes: encoder.encode(
              `INSERT INTO people (value) VALUES (${value});`,
            ),
          },
        },
      });

      assert.equal(outcome.status, "failed", `${toolId}: ${value}`);
      if (outcome.status === "failed") {
        assert.equal(outcome.error.code, "invalid-request", value);
        assert.deepEqual(outcome.telemetry, {
          start: "not-attempted",
          terminal: "not-attempted",
        });
      }
      assert.equal(deliveries.length, 0, `${toolId}: ${value}`);
    }
  }
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

test("XLSX output rejects all-empty data rows before processing", async () => {
  const { deliveries, workflow } = createRecordingWorkflow();
  const outcome = await workflow.run({
    toolId: "json-to-excel",
    input: {
      kind: "file",
      media: {
        name: "empty-row.json",
        format: "json",
        mimeType: "application/json",
        bytes: encoder.encode('[{"name":"","note":""}]'),
      },
    },
  });

  assert.equal(outcome.status, "failed");
  if (outcome.status === "failed") {
    assert.equal(outcome.error.code, "invalid-request");
    assert.equal(outcome.telemetry.start, "not-attempted");
    assert.match(outcome.error.message, /empty XLSX row/i);
  }
  assert.equal(deliveries.length, 0);
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
  await verifyTablePdfOutput(deliveries[0]?.bytes ?? new Uint8Array(), {
    headers: ["name", "note"],
    rows: [["Ada", "analytical engine"]],
  });

  const blank = await PDFDocument.create();
  blank.addPage();
  await assert.rejects(
    verifyTablePdfOutput(await blank.save(), {
      headers: ["name"],
      rows: [["Ada"]],
    }),
    /schema|content/i,
  );
});

test("PDF verification rejects semantically complete text drawn outside actual page bounds", async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([80, 120]);
  page.drawText("name", { x: 70, y: 90, font, size: 9 });
  page.drawText("Ada", { x: 70, y: 70, font, size: 9 });

  await assert.rejects(
    verifyTablePdfOutput(await document.save(), {
      headers: ["name"],
      rows: [["Ada"]],
    }),
    /page bounds/i,
  );
});

test("PDF verification preserves every row across actual page breaks", async () => {
  const rows = Array.from({ length: 60 }, (_, index) => [
    `person-${index + 1}`,
    `note-${index + 1}`,
  ]);
  const { deliveries, workflow } = createRecordingWorkflow();
  const outcome = await workflow.run({
    toolId: "csv-to-pdf",
    input: {
      kind: "file",
      media: {
        name: "people.csv",
        format: "csv",
        mimeType: "text/csv",
        bytes: encoder.encode(
          ["name,note", ...rows.map((row) => row.join(","))].join("\r\n"),
        ),
      },
    },
  });

  assert.equal(outcome.status, "succeeded");
  const bytes = deliveries[0]?.bytes ?? new Uint8Array();
  assert.ok((await PDFDocument.load(bytes)).getPageCount() > 1);
  await verifyTablePdfOutput(bytes, { headers: ["name", "note"], rows });
});

test("raster table operations are explicitly unsupported without semantic visual proof", async () => {
  const twentyThreeColumns = Array.from(
    { length: 23 },
    (_, index) => `c${index + 1}`,
  );
  const oneHundredTwentyEightRows = Array.from(
    { length: 128 },
    (_, index) => `row-${index + 1}`,
  );
  const cases = [
    {
      toolId: "csv-to-png",
      format: "csv" as const,
      bytes: encoder.encode(
        `${twentyThreeColumns.join(",")}\r\n${twentyThreeColumns.map(() => "x").join(",")}\r\n`,
      ),
    },
    {
      toolId: "csv-to-jpeg",
      format: "csv" as const,
      bytes: encoder.encode(
        `name\r\n${oneHundredTwentyEightRows.join("\r\n")}\r\n`,
      ),
    },
    {
      toolId: "markdown-to-jpeg",
      format: "markdown" as const,
      bytes: encoder.encode("| name |\n| --- |\n| Ada |\n"),
    },
  ];
  for (const { toolId, format, bytes } of cases) {
    assert.equal(getTableOperationState(toolId).kind, "unsupported");
    const { deliveries, workflow } = createRecordingWorkflow();
    const outcome = await workflow.run({
      toolId,
      input: {
        kind: "file",
        media: {
          name: `people.${format}`,
          format,
          mimeType: tableInputContracts[format].mimeTypes[0]!,
          bytes,
        },
      },
    });
    assert.equal(outcome.status, "failed");
    if (outcome.status === "failed") {
      assert.equal(outcome.error.code, "unsupported-tool");
      assert.equal(outcome.telemetry.start, "not-attempted");
    }
    assert.equal(deliveries.length, 0);
  }
});

test("PDF rejects infeasible measured text widths and column layouts before telemetry", async () => {
  const hundredHeaders = Array.from(
    { length: 100 },
    (_, index) => `c${index + 1}`,
  );
  const cases = [
    encoder.encode(`name,note\r\nAda,${"W".repeat(80)}\r\n`),
    encoder.encode(
      `${hundredHeaders.join(",")}\r\n${hundredHeaders.map(() => "x").join(",")}\r\n`,
    ),
    encoder.encode("name,note\r\nAda,\r\n"),
  ];

  for (const bytes of cases) {
    const { deliveries, workflow } = createRecordingWorkflow();
    const outcome = await workflow.run({
      toolId: "csv-to-pdf",
      input: {
        kind: "file",
        media: {
          name: "long-cell.csv",
          format: "csv",
          mimeType: "text/csv",
          bytes,
        },
      },
    });

    assert.equal(outcome.status, "failed");
    if (outcome.status === "failed") {
      assert.equal(outcome.error.code, "invalid-request");
      assert.equal(outcome.telemetry.start, "not-attempted");
      assert.match(outcome.error.message, /lossless/i);
    }
    assert.equal(deliveries.length, 0);
  }
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
  assert.match(presentation, /deliveries\.release\(/);
  assert.match(presentation, /deliveries\.clear\(\)/);
  assert.match(presentation, /fileReader\.invalidate\(\)/);
  assert.match(presentation, /createLatestFileReader/);
  assert.match(presentation, /AbortController/);
  assert.match(presentation, /runAbortRef\.current\?\.abort\(\)/);
  assert.match(presentation, /disabled=\{!delivery\}/);
  assert.doesNotMatch(presentation, /table-convert\/convert/);
  assert.doesNotMatch(
    presentation,
    /beginToolRun|saveBlob|finishSuccess|finishFailure/,
  );
  assert.match(browserAdapter, /beginToolRun/);
  assert.match(browserAdapter, /finishSuccess/);
  assert.match(browserAdapter, /finishFailure/);
  assert.match(browserAdapter, /URL\.createObjectURL/);
});

test("table landing copy describes the explicit verified Convert action", () => {
  const landing = readFileSync(
    new URL(
      "../components/table-convert/TableConvertLanding.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.doesNotMatch(landing, /auto-convert/i);
  assert.match(landing, /Select Convert after each edit/);
  assert.match(landing, /Select Convert whenever you edit the table/);
});

test("browser delivery ownership retains only the latest result and supports explicit release", async () => {
  const { workflow, deliveries } = createBrowserTableWorkflow();
  const run = (name: string) =>
    workflow.run({
      toolId: "csv-to-json",
      input: {
        kind: "file",
        media: {
          name,
          format: "csv",
          mimeType: "text/csv",
          bytes: encoder.encode("name\nAda\n"),
        },
      },
    });

  const first = await run("first.csv");
  const firstDelivery =
    first.status === "succeeded" ? first.results[0] : undefined;
  assert.ok(firstDelivery);
  assert.ok(deliveries.get(firstDelivery.deliveryId));
  assert.match(deliveries.text(firstDelivery.deliveryId) ?? "", /"Ada"/);

  const second = await run("second.csv");
  const secondDelivery =
    second.status === "succeeded" ? second.results[0] : undefined;
  assert.ok(secondDelivery);
  assert.equal(deliveries.get(firstDelivery.deliveryId), undefined);
  assert.ok(deliveries.get(secondDelivery.deliveryId));

  deliveries.release(secondDelivery.deliveryId);
  assert.equal(deliveries.get(secondDelivery.deliveryId), undefined);

  const binary = await workflow.run({
    toolId: "csv-to-excel",
    input: {
      kind: "file",
      media: {
        name: "workbook.csv",
        format: "csv",
        mimeType: "text/csv",
        bytes: encoder.encode("name\nAda\n"),
      },
    },
  });
  const binaryDelivery =
    binary.status === "succeeded" ? binary.results[0] : undefined;
  assert.ok(binaryDelivery);
  assert.equal(deliveries.text(binaryDelivery.deliveryId), undefined);
});

test("latest file reader discards superseded and invalidated asynchronous reads", async () => {
  const reader = createLatestFileReader();
  let releaseOld: ((value: ArrayBuffer) => void) | undefined;
  const oldFile = {
    arrayBuffer: () =>
      new Promise<ArrayBuffer>((resolve) => {
        releaseOld = resolve;
      }),
  };
  const newFile = {
    arrayBuffer: async () => Uint8Array.from([2]).buffer,
  };

  const oldRead = reader.read(oldFile);
  const newRead = reader.read(newFile);
  assert.deepEqual(await newRead, Uint8Array.from([2]));
  releaseOld?.(Uint8Array.from([1]).buffer);
  assert.equal(await oldRead, undefined);

  const invalidatedRead = reader.read(newFile);
  reader.invalidate();
  assert.equal(await invalidatedRead, undefined);
});
