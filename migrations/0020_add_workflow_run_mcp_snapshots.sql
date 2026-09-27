ALTER TABLE workflow_runs ADD COLUMN mcp_tool_snapshots_json TEXT;

CREATE TABLE mcp_server_credentials (
  server_id TEXT PRIMARY KEY,
  secret_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (secret_id) REFERENCES provider_credential_vault(secret_id) ON DELETE CASCADE
);
