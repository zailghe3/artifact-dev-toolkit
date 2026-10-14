-- Keep the existing writes table compatible with older Worker writers during rollout.
-- Writes without a companion row retain the legacy empty task path.
CREATE TABLE langgraph_checkpoint_write_task_paths (
 run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
 checkpoint_namespace TEXT NOT NULL,
 checkpoint_id TEXT NOT NULL,
 task_id TEXT NOT NULL,
 task_path TEXT NOT NULL,
 PRIMARY KEY(run_id, checkpoint_namespace, checkpoint_id, task_id)
);
