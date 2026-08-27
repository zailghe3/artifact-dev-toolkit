import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration0001 = readFileSync('migrations/0001_create_auth_sessions.sql', 'utf8');
const migration0002 = readFileSync('migrations/0002_rebuild_auth_sessions.sql', 'utf8');
const migration0009 = readFileSync('migrations/0009_create_provider_credential_vault.sql', 'utf8');

test('0001 retains original AUTH-001 schema', () => {
  assert.match(migration0001, /revoked_at INTEGER\n\);/);
  assert.doesNotMatch(migration0001, /authorization_state|repository_owner|encrypted_user_access_token/);
});

test('0002 destructively rebuilds to complete current AUTH-002 session schema', () => {
  assert.match(migration0002, /DROP TABLE IF EXISTS auth_sessions/);
  for (const column of ['authorization_state', 'denial_reason', 'repository_owner', 'repository_name', 'repository_id', 'installation_id', 'authorization_checked_at', 'encrypted_user_access_token', 'user_access_token_expires_at', 'token_iv']) {
    assert.match(migration0002, new RegExp(column));
  }
  assert.match(migration0002, /auth_sessions_authorization_idx/);
});

test('0009 adds an independent provider credential vault without altering legacy connections', () => {
  assert.match(migration0009, /CREATE TABLE provider_credential_vault/);
  for (const column of ['secret_id', 'encrypted_credential', 'credential_iv', 'encryption_version', 'master_key_version', 'created_at', 'updated_at']) {
    assert.match(migration0009, new RegExp(column));
  }
  assert.doesNotMatch(migration0009, /workflow_provider_connections|DROP TABLE|ALTER TABLE|UPDATE |DELETE FROM|INSERT INTO/);
});
