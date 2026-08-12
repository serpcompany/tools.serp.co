import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeWorkflowOwnership } from './workflow-ownership.mjs';

test('accepted workflow interface allows presentation-only state and delegates lifecycle ownership', () => {
  const result = analyzeWorkflowOwnership(
    new Map([
      [
        'apps/tools/app/tool/page.tsx',
        "import ToolView from '../../components/ToolView'; export default ToolView;",
      ],
      [
        'apps/tools/components/ToolView.tsx',
        "import { useTool } from '../lib/useTool'; export default function ToolView() { const state = useTool(); return <button onClick={state.run}>Run</button>; }",
      ],
      [
        'apps/tools/lib/useTool.ts',
        "import { createToolWorkflow } from './tool-workflow'; export function useTool() { return { run: () => createToolWorkflow().run({}) }; }",
      ],
      [
        'apps/tools/lib/browser-workflow-lifecycle.ts',
        "import { beginToolRun } from './telemetry'; export const deliver = () => URL.createObjectURL(new Blob());",
      ],
    ]),
  );

  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.reachablePresentationModules, [
    'apps/tools/app/tool/page.tsx',
    'apps/tools/components/ToolView.tsx',
  ]);
});

test('violations name the shared lifecycle interface and actionable migration', () => {
  const result = analyzeWorkflowOwnership(
    new Map([
      [
        'apps/tools/app/tool/page.tsx',
        "import ToolView from '../../components/ToolView'; export default ToolView;",
      ],
      [
        'apps/tools/components/ToolView.tsx',
        "import { beginToolRun } from '../lib/telemetry'; export default function ToolView() { const worker = new Worker('worker.js'); const url = URL.createObjectURL(new Blob()); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'result.bin'; anchor.click(); beginToolRun({}); return <button onClick={() => worker.terminate()}>{url}</button>; }",
      ],
    ]),
  );

  assert.deepEqual(
    result.violations.map(({ concept }) => concept),
    ['terminal-telemetry', 'worker-lifecycle', 'object-url-delivery'],
  );
  assert.match(
    result.violations[0].remediation,
    /workflow\.run.*browser-workflow-lifecycle/u,
  );
});

test('processor-specific worker and decoder object URL logic is not shared lifecycle policy', () => {
  const result = analyzeWorkflowOwnership(
    new Map([
      [
        'apps/tools/lib/convert/processor.ts',
        "export const process = () => new Worker('worker.js');",
      ],
      [
        'apps/tools/lib/another-family/processor.ts',
        'export const decode = (blob) => URL.createObjectURL(blob);',
      ],
    ]),
  );

  assert.deepEqual(result.violations, []);
});

test('route-owned presentation cannot recreate Worker or streamed-reader lifecycle', () => {
  const result = analyzeWorkflowOwnership(
    new Map([
      [
        'apps/tools/app/tool/page.tsx',
        "export default function Page() { const worker = new Worker('worker.js'); new ReadableStream().getReader(); return <button onClick={() => worker.terminate()}>Run</button>; }",
      ],
    ]),
  );

  assert.deepEqual(
    result.violations.map(({ concept }) => concept),
    ['worker-lifecycle', 'streamed-reader'],
  );
});

test('aliased telemetry and global or destructured URL delivery cannot bypass ownership', () => {
  const result = analyzeWorkflowOwnership(
    new Map([
      [
        'apps/tools/app/tool/page.tsx',
        "import ToolView from '../../components/ToolView'; export default ToolView;",
      ],
      [
        'apps/tools/components/ToolView.tsx',
        "import { beginToolRun as start } from '../lib/telemetry'; const { createObjectURL: createUrl } = globalThis.URL; export default function ToolView() { start({}); const url = createUrl(new Blob()); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'result.bin'; anchor.click(); return <div>{url}</div>; }",
      ],
    ]),
  );

  assert.deepEqual(
    result.violations.map(({ concept }) => concept),
    ['terminal-telemetry', 'object-url-delivery'],
  );
});

test('package telemetry, window URL, and declarative downloads cannot bypass ownership', () => {
  const result = analyzeWorkflowOwnership(
    new Map([
      [
        'apps/tools/app/tool/page.tsx',
        "import { beginToolRun as start } from '@serp-tools/tool-telemetry/client'; const { createObjectURL: createUrl } = window.URL; export default function Page() { start({}); const url = createUrl(new Blob()); return <a href={url} download='result.bin'>Download</a>; }",
      ],
    ]),
  );

  assert.deepEqual(
    result.violations.map(({ concept }) => concept),
    ['terminal-telemetry', 'object-url-delivery'],
  );
});

test('dynamic imports keep presentation lifecycle ownership reachable', () => {
  const result = analyzeWorkflowOwnership(
    new Map([
      [
        'apps/tools/app/tool/page.tsx',
        'export async function load() { return import(`../../components/ToolView`); }',
      ],
      [
        'apps/tools/components/ToolView/index.mts',
        "export default function ToolView() { return new window.Worker('worker.js'); }",
      ],
    ]),
  );

  assert.deepEqual(
    result.violations.map(({ concept }) => concept),
    ['worker-lifecycle'],
  );
});

test('reachable colocated route presentation cannot own lifecycle primitives', () => {
  const result = analyzeWorkflowOwnership(
    new Map([
      [
        'apps/tools/app/tool/page.tsx',
        "import View from './View'; export default View;",
      ],
      [
        'apps/tools/app/tool/View.jsx',
        'export default function View() { const url = URL.createObjectURL(new Blob()); return <div>{url}</div>; }',
      ],
    ]),
  );
  assert.deepEqual(
    result.violations.map(({ concept }) => concept),
    ['object-url-delivery'],
  );
});

test('default telemetry facade wrappers retain raw terminal ownership', () => {
  const result = analyzeWorkflowOwnership(
    new Map([
      [
        'apps/tools/app/tool/page.tsx',
        "import start from '../../lib/run-facade'; export default function Page() { start({}); return <div />; }",
      ],
      [
        'apps/tools/lib/run-facade.ts',
        "import { beginToolRun as rawStart } from './telemetry'; export default function (options) { return rawStart(options); }",
      ],
      [
        'apps/tools/lib/telemetry.ts',
        "export { beginToolRun } from '@serp-tools/tool-telemetry/client';",
      ],
    ]),
  );
  assert.deepEqual(
    result.violations.map(({ concept }) => concept),
    ['terminal-telemetry'],
  );
});

test('ordinary presentation state progress is not lifecycle policy ownership', () => {
  const result = analyzeWorkflowOwnership(
    new Map([
      [
        'apps/tools/app/tool/page.tsx',
        'export default function Page() { const setProgress = () => {}; setProgress(50); return <div />; }',
      ],
    ]),
  );
  assert.deepEqual(result.violations, []);
});

test('local telemetry facades and computed URL helpers cannot hide presentation ownership', () => {
  const result = analyzeWorkflowOwnership(
    new Map([
      [
        'apps/tools/app/tool/page.tsx',
        "import ToolView from '../../components/ToolView'; export default ToolView;",
      ],
      [
        'apps/tools/components/ToolView.tsx',
        "import { startRun } from '../lib/run-facade'; import { clickDownload } from '../lib/click-download'; export default function ToolView() { startRun({}); const url = URL['createObjectURL'](new Blob()); clickDownload(url); return <div>{url}</div>; }",
      ],
      [
        'apps/tools/lib/run-facade.ts',
        "import { beginToolRun as rawStart } from './telemetry'; export function startRun(options) { return rawStart(options); }",
      ],
      [
        'apps/tools/lib/telemetry.ts',
        "export { beginToolRun } from '@serp-tools/tool-telemetry/client';",
      ],
      [
        'apps/tools/lib/click-download.ts',
        "export function clickDownload(url) { const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'result.bin'; anchor.click(); }",
      ],
    ]),
  );

  assert.deepEqual(
    result.violations.map(({ concept }) => concept),
    ['terminal-telemetry', 'object-url-delivery'],
  );
});

test('processor modules may use lifecycle-shaped primitives for tool-specific work', () => {
  const result = analyzeWorkflowOwnership(
    new Map([
      [
        'apps/tools/lib/convert/processor.ts',
        "export function process(blob, menu) { const url = URL.createObjectURL(blob); const worker = new window.Worker('decoder.js'); const reader = blob.stream().getReader(); menu.download = false; menu.click(); return { url, worker, reader }; }",
      ],
    ]),
  );

  assert.deepEqual(result.violations, []);
  assert.deepEqual(Object.keys(result.lifecycleInventory), [
    'terminal-telemetry',
    'object-url-delivery',
    'worker-lifecycle',
    'streamed-reader',
    'upload-read-ownership',
    'progress-policy',
  ]);
  assert.deepEqual(
    result.lifecycleInventory['worker-lifecycle'].sharedOwnerModules,
    [],
  );
  assert.deepEqual(
    result.lifecycleInventory['worker-lifecycle'].toolSpecificOrSupportModules,
    ['apps/tools/lib/convert/processor.ts'],
  );
});

test('reachable family adapters must cross the accepted workflow.run seam', () => {
  const noOp = analyzeWorkflowOwnership(
    new Map([
      [
        'apps/tools/app/tool/page.tsx',
        "import { createBrowserTableWorkflow } from '../../lib/table-browser-workflow'; export default function Page() { createBrowserTableWorkflow(); return <div />; }",
      ],
      [
        'apps/tools/lib/table-browser-workflow.ts',
        'export function createBrowserTableWorkflow() { return { workflow: { run() {} } }; }',
      ],
    ]),
  );
  assert.deepEqual(
    noOp.violations.map(({ concept }) => concept),
    ['missing-workflow-run'],
  );
  assert.match(noOp.violations[0].remediation, /ToolWorkflow\.run/);

  const delegated = analyzeWorkflowOwnership(
    new Map([
      [
        'apps/tools/app/tool/page.tsx',
        "import { createBrowserTableWorkflow as create } from '../../lib/table-browser-workflow'; export default function Page() { const { workflow } = create(); void workflow.run({}); return <div />; }",
      ],
      [
        'apps/tools/lib/table-browser-workflow.ts',
        'export function createBrowserTableWorkflow() { return { workflow: { run() {} } }; }',
      ],
    ]),
  );
  assert.deepEqual(delegated.violations, []);
  assert.deepEqual(delegated.familySeamEvidence, {
    'apps/tools/lib/table-browser-workflow.ts': [
      'apps/tools/app/tool/page.tsx',
    ],
  });

  const unrelated = analyzeWorkflowOwnership(
    new Map([
      [
        'apps/tools/app/tool/page.tsx',
        "import { createBrowserTableWorkflow } from '../../lib/table-browser-workflow'; const unrelatedWorkflow = { run() {} }; export default function Page() { createBrowserTableWorkflow(); unrelatedWorkflow.run(); return <div />; }",
      ],
      [
        'apps/tools/lib/table-browser-workflow.ts',
        'export function createBrowserTableWorkflow() { return { workflow: { run() {} } }; }',
      ],
    ]),
  );
  assert.deepEqual(
    unrelated.violations.map(({ concept }) => concept),
    ['missing-workflow-run'],
  );

  const referenceOnly = analyzeWorkflowOwnership(
    new Map([
      [
        'apps/tools/app/tool/page.tsx',
        "import { createBrowserTableWorkflow } from '../../lib/table-browser-workflow'; const unrelatedWorkflow = { factory: createBrowserTableWorkflow, run() {} }; export default function Page() { unrelatedWorkflow.run(); return <div />; }",
      ],
      [
        'apps/tools/lib/table-browser-workflow.ts',
        'export function createBrowserTableWorkflow() { return {}; }',
      ],
    ]),
  );
  assert.deepEqual(
    referenceOnly.violations.map(({ concept }) => concept),
    ['missing-workflow-run'],
  );

  const adapterLocalUnrelated = analyzeWorkflowOwnership(
    new Map([
      [
        'apps/tools/app/tool/page.tsx',
        "import { createBrowserTableWorkflow } from '../../lib/table-browser-workflow'; export default function Page() { createBrowserTableWorkflow(); return <div />; }",
      ],
      [
        'apps/tools/lib/table-browser-workflow.ts',
        'export function createBrowserTableWorkflow() { const unrelated = { run() {} }; unrelated.run(); return {}; }',
      ],
    ]),
  );
  assert.deepEqual(
    adapterLocalUnrelated.violations.map(({ concept }) => concept),
    ['missing-workflow-run'],
  );

  const propertyNameContamination = analyzeWorkflowOwnership(
    new Map([
      [
        'apps/tools/app/tool/page.tsx',
        "import { createBrowserTableWorkflow } from '../../lib/table-browser-workflow'; const unrelated = { run() {} }; export default function Page() { const { workflow: ignored } = createBrowserTableWorkflow(); const workflow = unrelated; workflow.run(); return <div>{ignored}</div>; }",
      ],
      [
        'apps/tools/lib/table-browser-workflow.ts',
        'export function createBrowserTableWorkflow() { return { workflow: {} }; }',
      ],
    ]),
  );
  assert.deepEqual(
    propertyNameContamination.violations.map(({ concept }) => concept),
    ['missing-workflow-run'],
  );

  const unrelatedInternalFactory = analyzeWorkflowOwnership(
    new Map([
      [
        'apps/tools/app/tool/page.tsx',
        "import { createBrowserTableWorkflow } from '../../lib/table-browser-workflow'; export default function Page() { createBrowserTableWorkflow(); return <div />; }",
      ],
      [
        'apps/tools/lib/table-browser-workflow.ts',
        'function createLoggingWorkflow() { return { run() {} }; } export function createBrowserTableWorkflow() { const logging = createLoggingWorkflow(); logging.run(); return {}; }',
      ],
    ]),
  );
  assert.deepEqual(
    unrelatedInternalFactory.violations.map(({ concept }) => concept),
    ['missing-workflow-run'],
  );
});

test('new reachable browser workflow adapters enter seam and ownership enforcement automatically', () => {
  const result = analyzeWorkflowOwnership(
    new Map([
      [
        'apps/tools/app/tool/page.tsx',
        "import { createBrowserNovelWorkflow } from '../../lib/novel-browser-workflow'; export default function Page() { createBrowserNovelWorkflow(); return <div />; }",
      ],
      [
        'apps/tools/lib/novel-browser-workflow.ts',
        'export const createBrowserNovelWorkflow = () => { const url = URL.createObjectURL(new Blob()); return { url }; };',
      ],
    ]),
  );
  assert.deepEqual(
    result.violations.map(({ concept }) => concept),
    ['object-url-delivery', 'missing-workflow-run'],
  );
});
