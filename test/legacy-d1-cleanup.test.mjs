import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import test from 'node:test';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';

const cleanup = readFileSync(new URL('../scripts/maintenance/retire-d1-operational-state.sql', import.meta.url), 'utf8');

test('D1 retirement guards against schema drift and preserves active web sessions', async t => {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: 'export default {fetch(){return new Response("ok")}}',
    d1Databases: { DB: 'adt-retirement-fixture' },
  }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const batch = sql => db.batch(sql.split(';').map(value => value.trim()).filter(Boolean).map(value => db.prepare(value)));
  for (const directory of ['migrations', 'test-fixtures/legacy-operational-migrations']) {
    const root = new URL(`../${directory}/`, import.meta.url);
    for (const name of readdirSync(root).filter(name => name.endsWith('.sql')).sort()) {
      await batch(readFileSync(new URL(name, root), 'utf8'));
    }
  }
  await batch(`
    INSERT INTO auth_sessions(id,github_id,login,expires_at,created_at,authorization_state,repository_owner,repository_name,authorization_checked_at)
    VALUES ('browser-session',1,'user',1000,10,'authorized','owner','repo',11);
    CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO d1_migrations VALUES (1,'0001_create_auth_sessions.sql');
    INSERT INTO provider_credential_vault(secret_id,encrypted_credential,credential_iv,encryption_version,master_key_version,created_at,updated_at,revision)
    VALUES ('old-credential','ciphertext-fixture','iv-fixture',1,1,'2026-01-01','2026-01-01',1);
    INSERT INTO workflow_runs(id,engine_version,workflow_id,workflow_revision,workflow_snapshot_json,agent_snapshots_json,agent_revisions_json,connection_snapshots_json,
      initial_input,status,created_at,updated_at)
    VALUES ('old-run','2','workflow','revision','{}','{}','{}','{}','old-input','succeeded','2026-01-01','2026-01-01');
    INSERT INTO workflow_step_attempts(run_id,step_id,iteration,attempt,agent_id,connection_key,status)
    VALUES ('old-run','step',1,1,'agent','connection','succeeded');
    CREATE INDEX unexpected_workflow_index ON workflow_runs(id);
  `);
  await assert.rejects(batch(cleanup), /unexpected_d1_schema|CHECK constraint failed/);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM provider_credential_vault').first()).count, 1);
  await batch('DROP INDEX unexpected_workflow_index;');
  await batch(cleanup);
  const {results} = await db.prepare("SELECT name FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' AND tbl_name NOT IN ('_cf_KV','_cf_METADATA') ORDER BY name").all();
  assert.deepEqual(results.map(row => row.name), ['auth_sessions','auth_sessions_authorization_idx','auth_sessions_expires_at_idx','d1_migrations']);
  assert.equal((await db.prepare("SELECT login FROM auth_sessions WHERE id='browser-session'").first()).login, 'user');
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM d1_migrations').first()).count, 1);
  await assert.rejects(batch(cleanup), /unexpected_d1_schema|CHECK constraint failed/);
});
