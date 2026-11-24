ALTER TABLE provider_credential_vault ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

CREATE TABLE work_iq_oauth_states (
  state_hash TEXT PRIMARY KEY,
  connection_key TEXT NOT NULL,
  repository_revision TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  session_hash TEXT NOT NULL,
  verifier_secret_ref TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX work_iq_oauth_states_expiry_idx ON work_iq_oauth_states(expires_at);
