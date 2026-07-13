CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  github_id INTEGER NOT NULL,
  login TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  authorization_state TEXT NOT NULL CHECK (authorization_state IN ('authorized', 'denied')),
  denial_reason TEXT CHECK (denial_reason IN ('configuration', 'allowlist', 'app_access', 'user_access', 'temporary_unavailable')),
  repository_owner TEXT NOT NULL,
  repository_name TEXT NOT NULL,
  repository_id INTEGER,
  installation_id INTEGER,
  authorization_checked_at INTEGER NOT NULL,
  encrypted_user_access_token TEXT,
  user_access_token_expires_at INTEGER,
  token_iv TEXT
);

CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions (expires_at);
CREATE INDEX IF NOT EXISTS auth_sessions_authorization_idx ON auth_sessions (github_id, repository_owner, repository_name, repository_id, installation_id, authorization_state);
