ALTER TABLE workflow_runs ADD COLUMN mcp_tool_snapshots_json TEXT;

CREATE TABLE mcp_server_credentials (
  repository_id INTEGER NOT NULL,
  server_id TEXT NOT NULL,
  secret_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (repository_id, server_id),
  FOREIGN KEY (secret_id) REFERENCES provider_credential_vault(secret_id) ON DELETE CASCADE
);
