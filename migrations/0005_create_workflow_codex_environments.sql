CREATE TABLE workflow_codex_environments (
 environment_key TEXT PRIMARY KEY,
 display_name TEXT NOT NULL,
 external_environment_id TEXT NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
ALTER TABLE workflow_step_attempts ADD COLUMN provider_task_url TEXT;
