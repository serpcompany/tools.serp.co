"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { objectsToTableData, tableDataToObjects } from "./convert";
import { TableData } from "./types";

type DataGridEditorProps = {
  // The table on screen, or null while the input has none: the grid is then
  // removed, so it can't show or take edits to an earlier table.
  tableData: TableData | null;
  // Which table this is (output-state.ts). Each edit reports the origin of
  // the table the grid was showing, so an edit of an earlier table is dropped.
  origin: number;
  onChange?: (table: TableData, origin: number) => void;
};

type DataGridXLEvents = {
  on?: (eventName: string, handler: (event: unknown) => void) => void;
  off?: (eventName: string, handler: (event: unknown) => void) => void;
};

type DataGridXLInstance = {
  destroy?: () => void;
  getData?: () => Array<Record<string, unknown>>;
  setCellValues?: (coords: { x: number; y: number }, values: string[][], expand?: boolean) => void;
  deleteRows?: (range: [number, number]) => void;
  deleteCols?: (range: [number, number]) => void;
  events?: DataGridXLEvents;
};

type DataGridXLConstructor = new (
  containerId: string,
  options?: {
    data?: Array<Record<string, string>>;
  }
) => DataGridXLInstance;

declare global {
  interface Window {
    DataGridXL?: DataGridXLConstructor;
  }
}

const SCRIPT_SRC = "https://code.datagridxl.com/datagridxl2.js";
const SCRIPT_MARKER = "data-dgxl-script";

const NO_TABLE = "The editor shows the table once the input reads as one.";

// DataGridXL moves focus into its cell editor a moment after its data
// changes, and then takes the keys typed anywhere on the page (select all,
// delete) until a mousedown outside it. So while the visitor types in the
// input, the keys that follow a change would edit the grid instead. When the
// page changes the grid's data, focus that was outside the grid goes back
// there, with a mousedown outside the grid to tell it the visitor isn't in
// it, unless the visitor reaches for the grid (a pointer or Tab) meanwhile.
const FOCUS_GUARD_MS = 1000;
function keepFocusOutside(container: HTMLElement) {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || focused === document.body || container.contains(focused)) return;
  const stop = () => {
    window.clearTimeout(timer);
    container.removeEventListener("focusin", restore);
    container.removeEventListener("pointerdown", stop, true);
    document.removeEventListener("keydown", onKey, true);
  };
  // Focus goes back to where it came from, once the grid is done focusing
  // itself.
  const restore = (event: FocusEvent) => {
    const from = event.relatedTarget;
    if (!(from instanceof HTMLElement) || container.contains(from)) return;
    queueMicrotask(() => {
      if (!from.isConnected || !container.contains(document.activeElement)) return;
      from.focus({ preventScroll: true });
      from.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    });
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Tab") stop();
  };
  const timer = window.setTimeout(stop, FOCUS_GUARD_MS);
  container.addEventListener("focusin", restore);
  container.addEventListener("pointerdown", stop, true);
  document.addEventListener("keydown", onKey, true);
}

const areArraysEqual = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const areTablesEqual = (left: TableData, right: TableData) => {
  if (!areArraysEqual(left.headers, right.headers)) return false;
  if (left.rows.length !== right.rows.length) return false;
  for (let rowIndex = 0; rowIndex < left.rows.length; rowIndex += 1) {
    const leftRow = left.rows[rowIndex] ?? [];
    const rightRow = right.rows[rowIndex] ?? [];
    if (!areArraysEqual(leftRow, rightRow)) return false;
  }
  return true;
};

export default function DataGridEditor({ tableData, origin, onChange }: DataGridEditorProps) {
  const reactId = useId();
  const containerId = useMemo(
    () => `datagridxl-${reactId.replace(/:/g, "")}`,
    [reactId]
  );
  const gridRef = useRef<DataGridXLInstance | null>(null);
  const latestRef = useRef({ tableData, origin });
  // The origin of the table the grid holds.
  const shownOriginRef = useRef<number | null>(null);
  const onChangeRef = useRef<DataGridEditorProps["onChange"]>(onChange);
  const changeHandlerRef = useRef<((event: unknown) => void) | null>(null);
  const syncingRef = useRef(false);
  const [status, setStatus] = useState("Loading editor...");

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    latestRef.current = { tableData, origin };
  }, [tableData, origin]);

  const removeGrid = useCallback(() => {
    if (changeHandlerRef.current) {
      gridRef.current?.events?.off?.("change", changeHandlerRef.current);
    }
    changeHandlerRef.current = null;
    gridRef.current?.destroy?.();
    gridRef.current = null;
    shownOriginRef.current = null;
  }, []);

  const initializeGrid = useCallback(
    (nextData: TableData, nextOrigin: number) => {
      const DataGridXL = window.DataGridXL;
      if (!DataGridXL) {
        setStatus("Editor failed to load.");
        return;
      }
      const container = document.getElementById(containerId);
      if (!container) {
        setStatus("Editor container missing.");
        return;
      }
      removeGrid();
      syncingRef.current = true;
      keepFocusOutside(container);
      const grid = new DataGridXL(containerId, {
        data: tableDataToObjects(nextData),
      });
      gridRef.current = grid;
      shownOriginRef.current = nextOrigin;
      const handleGridChange = () => {
        if (syncingRef.current || gridRef.current !== grid) return;
        const handler = onChangeRef.current;
        const shownOrigin = shownOriginRef.current;
        if (!handler || !grid.getData || shownOrigin === null) return;
        const data = grid.getData();
        if (!Array.isArray(data)) return;
        handler(objectsToTableData(data as Array<Record<string, unknown>>), shownOrigin);
      };
      changeHandlerRef.current = handleGridChange;
      grid.events?.on?.("change", handleGridChange);
      syncingRef.current = false;
      setStatus("Editor ready.");
    },
    [containerId, removeGrid]
  );

  // Shows the latest table, or no grid while there's none.
  const showLatest = useCallback(() => {
    const latest = latestRef.current;
    if (latest.tableData) {
      initializeGrid(latest.tableData, latest.origin);
    } else {
      setStatus(NO_TABLE);
    }
  }, [initializeGrid]);

  useEffect(() => {
    let isMounted = true;

    if (window.DataGridXL) {
      if (isMounted) {
        showLatest();
      }
      return () => {
        isMounted = false;
        removeGrid();
      };
    }

    let script = document.querySelector<HTMLScriptElement>(`script[${SCRIPT_MARKER}]`);
    if (!script) {
      script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.setAttribute(SCRIPT_MARKER, "true");
      document.body.appendChild(script);
    }

    const handleLoad = () => {
      if (!isMounted) return;
      showLatest();
    };
    const handleError = () => {
      if (!isMounted) return;
      setStatus("Editor failed to load.");
    };

    script.addEventListener("load", handleLoad);
    script.addEventListener("error", handleError);

    return () => {
      isMounted = false;
      script?.removeEventListener("load", handleLoad);
      script?.removeEventListener("error", handleError);
      removeGrid();
    };
  }, [containerId, removeGrid, showLatest]);

  useEffect(() => {
    if (!window.DataGridXL) return;
    if (!tableData) {
      removeGrid();
      setStatus(NO_TABLE);
      return;
    }
    const grid = gridRef.current;
    if (!grid) {
      initializeGrid(tableData, origin);
      return;
    }
    if (!grid.getData || !grid.setCellValues) return;
    const currentData = grid.getData();
    if (!Array.isArray(currentData)) return;

    const currentTable = objectsToTableData(currentData as Array<Record<string, unknown>>);
    if (areTablesEqual(currentTable, tableData)) {
      shownOriginRef.current = origin;
      return;
    }

    if (!areArraysEqual(currentTable.headers, tableData.headers)) {
      initializeGrid(tableData, origin);
      return;
    }

    syncingRef.current = true;
    const container = document.getElementById(containerId);
    if (container) keepFocusOutside(container);
    const currentRows = currentTable.rows.length;
    const currentCols = currentTable.headers.length;
    const nextRows = tableData.rows.length;
    const nextCols = tableData.headers.length;

    if (grid.deleteCols && nextCols < currentCols) {
      grid.deleteCols([nextCols, currentCols - 1]);
    }
    if (grid.deleteRows && nextRows < currentRows) {
      grid.deleteRows([nextRows, currentRows - 1]);
    }

    const values = tableData.rows.map((row) =>
      tableData.headers.map((_, index) => row[index] ?? "")
    );
    if (values.length > 0 && values[0]?.length) {
      grid.setCellValues({ x: 0, y: 0 }, values, true);
    }
    shownOriginRef.current = origin;
    syncingRef.current = false;
  }, [containerId, initializeGrid, removeGrid, tableData, origin]);

  return (
    <div className="space-y-3">
      <div
        id={containerId}
        data-testid="dgxl-editor"
        className={`h-[420px] w-full overflow-hidden rounded-lg border bg-white ${tableData ? "" : "hidden"}`}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{status}</span>
      </div>
    </div>
  );
}
