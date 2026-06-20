CREATE TABLE IF NOT EXISTS tool_runs (
  id TEXT PRIMARY KEY NOT NULL,
  tool_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed')),
  started_at TEXT NOT NULL,
  duration_ms INTEGER,
  input_bytes INTEGER,
  output_bytes INTEGER,
  error_code TEXT,
  metadata TEXT CHECK (metadata IS NULL OR json_valid(metadata))
);

CREATE INDEX IF NOT EXISTS idx_tool_runs_tool_id_started_at
  ON tool_runs (tool_id, started_at);

CREATE INDEX IF NOT EXISTS idx_tool_runs_status_started_at
  ON tool_runs (status, started_at);

CREATE TABLE IF NOT EXISTS tool_status (
  tool_id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  last_run_at TEXT,
  failure_rate_24h REAL,
  median_duration_ms INTEGER,
  median_reduction_pct REAL,
  updated_at TEXT NOT NULL
);
