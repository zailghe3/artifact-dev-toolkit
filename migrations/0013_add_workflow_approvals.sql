-- SQLite cannot alter a CHECK constraint in place. Rebuild the current Phase 13
-- table exactly, adding waiting_approval while preserving every compatibility column.
CREATE TABLE workflow_step_attempts_phase14 AS SELECT * FROM workflow_step_attempts;
CREATE TABLE langgraph_checkpoints_phase14 AS SELECT * FROM langgraph_checkpoints;
CREATE TABLE langgraph_checkpoint_writes_phase14 AS SELECT * FROM langgraph_checkpoint_writes;
DROP TABLE langgraph_checkpoint_writes;
DROP TABLE langgraph_checkpoints;
DROP TABLE workflow_step_attempts;
CREATE TABLE workflow_runs_phase14 (
 id TEXT PRIMARY KEY, engine_version TEXT NOT NULL, workflow_id TEXT NOT NULL, workflow_revision TEXT NOT NULL,
 workflow_snapshot_json TEXT NOT NULL, agent_snapshots_json TEXT NOT NULL, agent_revisions_json TEXT NOT NULL, connection_snapshots_json TEXT NOT NULL,
 initial_input TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','running','waiting_approval','cancelling','succeeded','failed','cancelled')),
 current_step_id TEXT, transition_count INTEGER NOT NULL DEFAULT 0, state_version INTEGER NOT NULL DEFAULT 0,
 workflow_instance_id TEXT UNIQUE, reserved_workflow_instance_id TEXT, workflow_generation INTEGER NOT NULL DEFAULT 1,
 workflow_launch_state TEXT NOT NULL DEFAULT 'unclaimed' CHECK(workflow_launch_state IN ('unclaimed','launching','attached','launch_failed')),
 workflow_launch_failure TEXT, workflow_launch_attempted_at TEXT, client_idempotency_key TEXT UNIQUE,
 final_output TEXT, final_external_url TEXT, cancel_requested_at TEXT, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT,
 failure_code TEXT, failure_message TEXT, cancellation_result TEXT, updated_at TEXT NOT NULL,
 repository_context_json TEXT, execution_plan_json TEXT, semantic_workflow_snapshot_json TEXT
);
INSERT INTO workflow_runs_phase14 SELECT
 id,engine_version,workflow_id,workflow_revision,workflow_snapshot_json,agent_snapshots_json,agent_revisions_json,connection_snapshots_json,
 initial_input,status,current_step_id,transition_count,state_version,workflow_instance_id,reserved_workflow_instance_id,workflow_generation,
 workflow_launch_state,workflow_launch_failure,workflow_launch_attempted_at,client_idempotency_key,final_output,final_external_url,
 cancel_requested_at,created_at,started_at,completed_at,failure_code,failure_message,cancellation_result,updated_at,
 repository_context_json,execution_plan_json,semantic_workflow_snapshot_json
FROM workflow_runs;
DROP TABLE workflow_runs;
ALTER TABLE workflow_runs_phase14 RENAME TO workflow_runs;
CREATE INDEX workflow_runs_recent ON workflow_runs(created_at DESC);
CREATE INDEX workflow_runs_nonterminal ON workflow_runs(status,created_at) WHERE status IN ('queued','running','waiting_approval','cancelling');

CREATE TABLE workflow_step_attempts (
 run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE, step_id TEXT NOT NULL, iteration INTEGER NOT NULL, attempt INTEGER NOT NULL,
 agent_id TEXT NOT NULL, connection_key TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','starting','waiting_provider','succeeded','failed','cancelled')),
 input_text TEXT, output_text TEXT, output_external_url TEXT, provider_task_id TEXT, provider_state TEXT, provider_poll_count INTEGER NOT NULL DEFAULT 0,
 next_poll_delay_ms INTEGER, started_at TEXT, completed_at TEXT, failure_category TEXT, safe_failure_message TEXT, retryable INTEGER,
 provider_task_url TEXT, provider_client_request_id TEXT, provider_request_id TEXT, provider_http_status INTEGER, provider_elapsed_ms INTEGER,
 provider_processing_ms INTEGER, provider_transport_outcome TEXT CHECK(provider_transport_outcome IN ('response_received','timeout','network_error')),
 provider_transport_reason TEXT CHECK(provider_transport_reason IN ('cross_request_io','invalid_request_context','network_connection_lost','aborted','fetch_type_error','unknown')),
 provider_runtime_error_name TEXT CHECK(provider_runtime_error_name IN ('TypeError','AbortError','Error')), graph_activation_id TEXT,
 PRIMARY KEY(run_id,step_id,iteration,attempt)
);
INSERT INTO workflow_step_attempts SELECT * FROM workflow_step_attempts_phase14;
DROP TABLE workflow_step_attempts_phase14;
CREATE INDEX workflow_attempts_order ON workflow_step_attempts(run_id,iteration,step_id,attempt);
CREATE UNIQUE INDEX workflow_attempt_graph_activation ON workflow_step_attempts(run_id,step_id,graph_activation_id,attempt) WHERE graph_activation_id IS NOT NULL;

CREATE TABLE langgraph_checkpoints (
 run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE, checkpoint_namespace TEXT NOT NULL, checkpoint_id TEXT NOT NULL,
 parent_checkpoint_id TEXT, checkpoint_json TEXT NOT NULL, metadata_json TEXT NOT NULL, config_json TEXT NOT NULL,
 content_sha256 TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(run_id,checkpoint_namespace,checkpoint_id)
);
INSERT INTO langgraph_checkpoints SELECT * FROM langgraph_checkpoints_phase14;
DROP TABLE langgraph_checkpoints_phase14;
CREATE INDEX langgraph_checkpoints_thread_order ON langgraph_checkpoints(run_id,checkpoint_namespace,created_at DESC,checkpoint_id DESC);
CREATE TABLE langgraph_checkpoint_writes (
 run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE, checkpoint_namespace TEXT NOT NULL, checkpoint_id TEXT NOT NULL,
 task_id TEXT NOT NULL, write_index INTEGER NOT NULL, channel TEXT NOT NULL, value_json TEXT NOT NULL, content_sha256 TEXT NOT NULL,
 created_at TEXT NOT NULL, PRIMARY KEY(run_id,checkpoint_namespace,checkpoint_id,task_id,write_index)
);
INSERT INTO langgraph_checkpoint_writes SELECT * FROM langgraph_checkpoint_writes_phase14;
DROP TABLE langgraph_checkpoint_writes_phase14;

CREATE TABLE workflow_approvals (
 request_id TEXT PRIMARY KEY,
 run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
 workflow_generation INTEGER NOT NULL,
 node_id TEXT NOT NULL,
 activation_id TEXT NOT NULL,
 interrupt_id TEXT NOT NULL,
 message TEXT NOT NULL,
 review_text TEXT NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('pending','approved')),
 requested_at TEXT NOT NULL,
 approved_at TEXT,
 consumed_at TEXT,
 UNIQUE (run_id, workflow_generation, activation_id)
);
CREATE INDEX workflow_approvals_active ON workflow_approvals(run_id, consumed_at, status);
