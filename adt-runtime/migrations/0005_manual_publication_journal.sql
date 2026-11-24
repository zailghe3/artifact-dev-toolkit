CREATE TABLE manual_workflow_publications (
  run_id text NOT NULL REFERENCES workflow_runs ON DELETE CASCADE,
  step_id text NOT NULL,
  repository_task_id text NOT NULL,
  request_digest text NOT NULL,
  result jsonb,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (run_id, step_id, repository_task_id)
);
