CREATE TABLE workflow_provider_connections (
  connection_key TEXT PRIMARY KEY,
  adapter TEXT NOT NULL,
  default_model TEXT NOT NULL,
  encrypted_credential TEXT NOT NULL,
  credential_iv TEXT NOT NULL,
  encryption_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
