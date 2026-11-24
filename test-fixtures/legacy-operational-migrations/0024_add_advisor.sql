CREATE TABLE advisor_settings (
  repository_id INTEGER PRIMARY KEY,
  settings_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
);
ALTER TABLE workflow_runs ADD COLUMN advisor_context_json TEXT;
CREATE INDEX workflow_runs_repository_created_idx ON workflow_runs (
  json_extract(repository_context_json, '$.repositoryId'), created_at DESC, id DESC
);
