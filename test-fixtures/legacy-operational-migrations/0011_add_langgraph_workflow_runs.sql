-- Existing engine_version='1' rows retain their historical sequential interpretation.
ALTER TABLE workflow_runs ADD COLUMN execution_plan_json TEXT;
ALTER TABLE workflow_runs ADD COLUMN semantic_workflow_snapshot_json TEXT;

CREATE TABLE langgraph_checkpoints (
 run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
 checkpoint_namespace TEXT NOT NULL,
 checkpoint_id TEXT NOT NULL,
 parent_checkpoint_id TEXT,
 checkpoint_json TEXT NOT NULL,
 metadata_json TEXT NOT NULL,
 config_json TEXT NOT NULL,
 content_sha256 TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(run_id, checkpoint_namespace, checkpoint_id)
);
CREATE INDEX langgraph_checkpoints_thread_order ON langgraph_checkpoints(run_id, checkpoint_namespace, created_at DESC, checkpoint_id DESC);

CREATE TABLE langgraph_checkpoint_writes (
 run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
 checkpoint_namespace TEXT NOT NULL,
 checkpoint_id TEXT NOT NULL,
 task_id TEXT NOT NULL,
 write_index INTEGER NOT NULL,
 channel TEXT NOT NULL,
 value_json TEXT NOT NULL,
 content_sha256 TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(run_id, checkpoint_namespace, checkpoint_id, task_id, write_index)
);
