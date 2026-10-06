-- ============================================================
-- Adrian OSS: 001 initial schema
-- ============================================================
-- Idempotent (IF NOT EXISTS + INSERT OR IGNORE). Targets
-- SQLite >= 3.38 with the JSON1 extension.
--
-- WAL mode + foreign keys are enabled by the Go backend at
-- connection open via PRAGMAs; not declared here.
-- ============================================================


-- ----------------------------------------------------------------
-- 1. users  --  dashboard / API admins
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id                   TEXT    PRIMARY KEY,
    email                TEXT    NOT NULL UNIQUE,
    name                 TEXT    NOT NULL,
    role                 TEXT    NOT NULL DEFAULT 'admin'
                                 CHECK (role IN ('admin','member')),
    password_hash        TEXT    NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1
                                 CHECK (must_change_password IN (0,1)),
    created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);


-- ----------------------------------------------------------------
-- 2. user_sessions  --  server-side dashboard auth sessions
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id    ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);


-- ----------------------------------------------------------------
-- 5. agent_profiles  --  per-agent custom MAD policy
-- (declared before api_keys / events / verdicts that FK to it)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_profiles (
    id         TEXT    PRIMARY KEY,
    name       TEXT    NOT NULL UNIQUE,
    enabled    INTEGER NOT NULL DEFAULT 0
                       CHECK (enabled IN (0,1)),
    remit      TEXT    NOT NULL DEFAULT '',
    m0_entries TEXT    NOT NULL DEFAULT '[]',
    m3_entries TEXT    NOT NULL DEFAULT '[]',
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);


-- ----------------------------------------------------------------
-- 3. api_keys  --  SDK authentication
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
    id               TEXT PRIMARY KEY,
    key_hash         TEXT NOT NULL UNIQUE,
    prefix           TEXT NOT NULL,
    label            TEXT,
    agent_profile_id TEXT          REFERENCES agent_profiles(id) ON DELETE SET NULL,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    revoked_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);


-- ----------------------------------------------------------------
-- 4. agents  --  observed agent identities
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agents (
    id         TEXT PRIMARY KEY,
    agent_id   TEXT NOT NULL UNIQUE,
    first_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_seen  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    metadata   TEXT NOT NULL DEFAULT '{}'
);


-- ----------------------------------------------------------------
-- 6. policies  --  singleton row, host-wide execution policy
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS policies (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    mode       TEXT    NOT NULL DEFAULT 'alert'
                       CHECK (mode IN ('alert','hitl','block')),
    policy_m0  INTEGER NOT NULL DEFAULT 0 CHECK (policy_m0 IN (0,1)),
    policy_m2  INTEGER NOT NULL DEFAULT 0 CHECK (policy_m2 IN (0,1)),
    policy_m3  INTEGER NOT NULL DEFAULT 1 CHECK (policy_m3 IN (0,1)),
    policy_m4  INTEGER NOT NULL DEFAULT 1 CHECK (policy_m4 IN (0,1)),
    updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Singleton seed: ensures one row exists with the schema defaults.
INSERT OR IGNORE INTO policies (id) VALUES (1);


-- ----------------------------------------------------------------
-- 7. events  --  paired events from the SDK
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
    id               TEXT    PRIMARY KEY,
    session_id       TEXT    NOT NULL,
    agent_id         TEXT,
    agent_profile_id TEXT             REFERENCES agent_profiles(id) ON DELETE SET NULL,
    event_type       TEXT    NOT NULL,
    run_id           TEXT,
    payload          TEXT    NOT NULL,
    tokens_used      INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_events_session_id  ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at  ON events(created_at);


-- ----------------------------------------------------------------
-- 8. verdicts  --  classification results
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS verdicts (
    id               TEXT    PRIMARY KEY,
    event_id         TEXT    NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    session_id       TEXT    NOT NULL,
    agent_profile_id TEXT             REFERENCES agent_profiles(id) ON DELETE SET NULL,
    mad_code         TEXT    NOT NULL,
    classification   TEXT    NOT NULL CHECK (classification IN ('benign','notify','block')),
    reasoning        TEXT,
    latency_ms       INTEGER,
    tokens_used      INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_verdicts_event_id   ON verdicts(event_id);
CREATE INDEX IF NOT EXISTS idx_verdicts_session_id ON verdicts(session_id);
CREATE INDEX IF NOT EXISTS idx_verdicts_created_at ON verdicts(created_at);


-- ----------------------------------------------------------------
-- 9. hitl_queue  --  human-in-the-loop review queue
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hitl_queue (
    id          TEXT PRIMARY KEY,
    event_id    TEXT NOT NULL UNIQUE REFERENCES events(id)   ON DELETE CASCADE,
    verdict_id  TEXT                 REFERENCES verdicts(id) ON DELETE CASCADE,
    session_id  TEXT,
    mad_code    TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected')),
    reviewed_by TEXT          REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_hitl_queue_pending
    ON hitl_queue(created_at)
    WHERE status = 'pending';


-- ----------------------------------------------------------------
-- 10. webhooks  --  Discord notification config (single platform v1)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhooks (
    id                   TEXT    PRIMARY KEY,
    platform             TEXT    NOT NULL DEFAULT 'discord'
                                 CHECK (platform IN ('discord')),
    webhook_url          TEXT    NOT NULL,
    alert_type           TEXT    NOT NULL CHECK (alert_type IN ('M3','M4','all')),
    enabled              INTEGER NOT NULL DEFAULT 1
                                 CHECK (enabled IN (0,1)),
    installed_by_user_id TEXT             REFERENCES users(id) ON DELETE SET NULL,
    created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_webhooks_alert_enabled
    ON webhooks(alert_type)
    WHERE enabled = 1;


-- ----------------------------------------------------------------
-- 11. audit_log  --  admin-action audit trail
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id         TEXT PRIMARY KEY,
    user_id    TEXT          REFERENCES users(id) ON DELETE SET NULL,
    action     TEXT NOT NULL,
    target     TEXT,
    details    TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);


-- ----------------------------------------------------------------
-- 12. mcp_servers  --  MCP servers reported by SDK at login
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_servers (
    session_id  TEXT NOT NULL,
    name        TEXT NOT NULL,
    transport   TEXT NOT NULL
                     CHECK (transport IN ('stdio','sse','streamable_http','websocket','unknown')),
    endpoint    TEXT NOT NULL DEFAULT '',
    received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (session_id, name)
);
