CREATE TABLE workflow_runs (
 id TEXT PRIMARY KEY, engine_version TEXT NOT NULL, workflow_id TEXT NOT NULL, workflow_revision TEXT NOT NULL,
 workflow_snapshot_json TEXT NOT NULL, agent_snapshots_json TEXT NOT NULL, connection_snapshots_json TEXT NOT NULL,
 initial_input TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','running','cancelling','succeeded','failed','cancelled')),
 current_step_id TEXT, transition_count INTEGER NOT NULL DEFAULT 0, workflow_instance_id TEXT UNIQUE, client_idempotency_key TEXT UNIQUE,
 final_output TEXT, final_external_url TEXT, cancel_requested_at TEXT, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT,
 failure_code TEXT, failure_message TEXT
);
CREATE TABLE workflow_step_attempts (
 run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE, step_id TEXT NOT NULL, iteration INTEGER NOT NULL, attempt INTEGER NOT NULL,
 agent_id TEXT NOT NULL, connection_key TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','starting','waiting_provider','succeeded','failed','cancelled')),
 input_text TEXT, output_text TEXT, provider_task_id TEXT, provider_state TEXT, started_at TEXT, completed_at TEXT,
 failure_category TEXT, safe_failure_message TEXT, retryable INTEGER,
 PRIMARY KEY(run_id,step_id,iteration,attempt)
);
CREATE INDEX workflow_runs_recent ON workflow_runs(created_at DESC);
CREATE INDEX workflow_runs_nonterminal ON workflow_runs(status,created_at) WHERE status IN ('queued','running','cancelling');
CREATE INDEX workflow_attempts_order ON workflow_step_attempts(run_id,iteration,step_id,attempt);
