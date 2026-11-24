CREATE TABLE provider_credential_vault (
  secret_id TEXT PRIMARY KEY,
  encrypted_credential TEXT NOT NULL,
  credential_iv TEXT NOT NULL,
  encryption_version INTEGER NOT NULL,
  master_key_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
