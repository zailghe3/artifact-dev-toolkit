import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtemp, chmod, copyFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { initializeRuntimeDatabase, runtimePostgresPool } from '../../adt-runtime/dist/postgres.js';
import { PostgresWorkflowDatabase } from '../../adt-runtime/dist/workflow-database.js';
import { D1ProviderCredentialVault } from '../../lib/provider-credential-vault.ts';
import { D1WorkflowRunStorage } from '../../lib/workflow-d1-storage.ts';
import { D1WorkflowApprovalStore } from '../../lib/workflow-approvals.ts';
import { D1LangGraphCheckpointStore } from '../../lib/langgraph-checkpoints.ts';
import { createRuntimeServer } from '../../adt-runtime/dist/server.js';
import { operationalSettings, recordManagementNonce } from '../../adt-runtime/dist/operational-settings.js';
import { advisorSettingsRecordSchema, codexEnvironmentInputSchema, OPERATIONAL_SETTINGS_PATH } from '../../adt-runtime/dist/operational-settings-contract.js';
import { requestRuntimeOperationalSettings } from '../../lib/adt-runtime-client.ts';
import { nativeFixture } from '../support/native-adt-fixture.mjs';

const connectionString = process.env.ADT_TEST_POSTGRES_URL;

test('Runtime initializes PostgreSQL and retains its scoped vault and Workflow journals over restart', {
  skip: !connectionString && 'Set ADT_TEST_POSTGRES_URL to a disposable empty PostgreSQL database',
}, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'adt-root-key-'));
  const keyPath = join(directory, 'root.json');
  let pool = runtimePostgresPool({ connectionString });
  t.after(async () => {
    await pool.end();
    await rm(directory, { recursive: true });
  });

  const [installation, concurrent] = await Promise.all([
    initializeRuntimeDatabase(pool, keyPath),
    initializeRuntimeDatabase(pool, keyPath),
  ]);
  assert.equal(installation.rootKey.fingerprint(), concurrent.rootKey.fingerprint());
  assert.equal((await stat(keyPath)).mode & 0o777, 0o600);
  const openVault = (root, repositoryId, version = 1) =>
    new D1ProviderCredentialVault(new PostgresWorkflowDatabase(pool),
      keyVersion => root.vaultKey(repositoryId, keyVersion), version, undefined, undefined, repositoryId);

  const keys = generateKeyPairSync('rsa', {
    modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });
  const authSecret = 'postgres-integration-runtime-auth'.repeat(2);
  const startRuntime = async () => {
    const runtime = await createRuntimeServer({
      host: '127.0.0.1', port: 0, authSecret, privateKeyPem: keys.privateKey,
      revision: 'postgres-integration', operateSettings: command => operationalSettings(pool)(command),
      recordManagementNonce: (nonce, timestamp) => recordManagementNonce(pool, nonce, timestamp), logger() {},
    });
    await runtime.listen();
    return runtime;
  };
  let runtime = await startRuntime();
  t.after(() => runtime.close());
  const config = { baseUrl: `http://127.0.0.1:${runtime.server.address().port}`, authSecret };
  const advisor = (command, fetcher) => requestRuntimeOperationalSettings(config, command,
    value => advisorSettingsRecordSchema.parse(value), fetcher);

  const { status } = await fetch(config.baseUrl + OPERATIONAL_SETTINGS_PATH, { method: 'POST', body: '{}' });
  assert.equal(status, 401);
  const repositoryId = 42;
  const current = { operation: 'advisor.get', repositoryId };
  assert.deepEqual(await advisor(current), { settings: { workflowId: null, override: null }, revision: 0 });
  const settings = { workflowId: 'review', override: null };
  const update = { operation: 'advisor.save', repositoryId, revision: 0, settings };
  let sent;
  assert.deepEqual(await advisor(update, async (url, init) => {
    sent = [url, init];
    return fetch(url, init);
  }), { settings, revision: 1 });
  assert.equal((await fetch(...sent)).status, 401);
  assert.equal((await fetch(sent[0], { ...sent[1], body: JSON.stringify({ ...update, repositoryId: 7 }) })).status, 401);
  assert.deepEqual(await advisor(update), { settings, revision: 1 });
  await assert.rejects(advisor({ ...update, settings: { ...settings, workflowId: 'other' } }), /advisor_settings_conflict/);
  await assert.rejects(advisor({ ...update, settings: { ...settings, token: 'unexpected-value' } }), /runtime_settings_unavailable/);
  assert.equal((await advisor({ ...current, repositoryId: 7 })).revision, 0);

  const environment = { key: 'review', name: 'Review', externalEnvironmentId: 'runner-review', enabled: false };
  const codex = (command, parse) => requestRuntimeOperationalSettings(config, { repositoryId, ...command }, parse);
  const saveEnvironment = { operation: 'codex.save', environment, idempotencyKey: 'codex-save-1' };
  const parseEnvironment = value => codexEnvironmentInputSchema.parse(value);
  await codex(saveEnvironment, parseEnvironment);
  await assert.rejects(codex({ ...saveEnvironment, environment: { ...environment, enabled: true } },
    parseEnvironment), /runtime_settings_conflict/);
  const list = value => codexEnvironmentInputSchema.array().parse(value);
  assert.deepEqual(await codex({ operation: 'codex.list' }, list), [environment]);
  assert.deepEqual(await codex({ operation: 'codex.list', repositoryId: 7 }, list), []);
  await codex({ operation: 'codex.delete', key: environment.key, idempotencyKey: 'codex-delete-1' }, value => assert.equal(value, null));
  assert.deepEqual(await codex(saveEnvironment, parseEnvironment), environment);
  assert.deepEqual(await codex({ operation: 'codex.list' }, list), []);

  const vault = openVault(installation.rootKey, 17);
  const secret = await vault.create('integration-credential');
  const ciphertext = (await pool.query('SELECT encrypted_credential FROM provider_credential_vault WHERE secret_id = $1', [secret])).rows[0].encrypted_credential;
  assert.doesNotMatch(ciphertext, /integration-credential/);
  await assert.rejects(openVault(installation.rootKey, 7).resolve(secret), /vault_secret_unavailable/);
  assert.deepEqual(await vault.resolveWithRevision(secret), { value: 'integration-credential', revision: 1 });

  let currentDb = new PostgresWorkflowDatabase(pool);
  const database = {
    dialect: 'postgres',
    prepare: sql => currentDb.prepare(sql),
    batch: statements => currentDb.batch(statements),
  };
  const fixture = await nativeFixture(t, { db: database, vault });

  assert.equal((await fixture.step()).state, 'pending');
  assert.equal(fixture.models, 1);

  await pool.end();
  pool = runtimePostgresPool({ connectionString });
  const restarted = await initializeRuntimeDatabase(pool, keyPath);
  assert.equal(restarted.rootKey.fingerprint(), installation.rootKey.fingerprint());
  await runtime.close();
  runtime = await startRuntime();
  config.baseUrl = `http://127.0.0.1:${runtime.server.address().port}`;
  assert.equal((await fetch(config.baseUrl + OPERATIONAL_SETTINGS_PATH, sent[1])).status, 401);
  assert.deepEqual(await advisor(current), { settings, revision: 1 });
  const rotatedVault = openVault(restarted.rootKey, 17, 2);
  assert.equal(await rotatedVault.resolve(secret), 'integration-credential');
  assert.equal(await rotatedVault.replaceIfRevision(secret, 1, 'rotated-credential'), true);
  assert.equal(await rotatedVault.replaceIfRevision(secret, 1, 'lost-update'), false);
  assert.equal(await rotatedVault.resolve(secret), 'rotated-credential');
  assert.equal((await pool.query('SELECT master_key_version FROM provider_credential_vault WHERE secret_id = $1', [secret])).rows[0].master_key_version, 2);

  currentDb = new PostgresWorkflowDatabase(pool);
  const db = currentDb;
  const result = await fixture.finish();
  assert.equal(result.state, 'completed');
  assert.equal(fixture.models, 2);
  assert.equal(fixture.reads, 1);
  assert.equal((await fixture.step()).outputText, result.outputText);
  assert.equal(fixture.models, 2);

  const store = new D1WorkflowRunStorage(db);
  const run = await store.getRun(fixture.value.id);
  assert.equal(run.attempts[0].graphActivationId, 'activation');

  const approvals = new D1WorkflowApprovalStore(db);
  const approval = await approvals.require({
    runId: run.run.id, workflowGeneration: 1, nodeId: 'approve', activationId: 'a2',
    interruptId: 'interrupt', message: 'Review', reviewText: 'Proposal',
  });
  assert.equal((await approvals.active(run.run.id)).requestId, approval.requestId);
  await approvals.approve(run.run.id, approval.requestId);
  assert.equal(await approvals.consume(run.run.id, approval.requestId), true);
  assert.ok(await approvals.suspendedMs(run.run.id) >= 0);
  assert.equal(await approvals.consume(run.run.id, approval.requestId), false);

  const checkpoints = new D1LangGraphCheckpointStore(db);
  const configurable = { thread_id: run.run.id, checkpoint_ns: '' };
  const checkpoint = { id: 'checkpoint-1' };
  await checkpoints.execute(run.run.id, { threadId: run.run.id, operation: 'put', payload: { config: { configurable }, checkpoint, metadata: {} } });
  const recorded = await checkpoints.execute(run.run.id, { threadId: run.run.id, operation: 'get', payload: { config: { configurable } } });
  assert.deepEqual(recorded.checkpoint, checkpoint);

  await rename(keyPath, keyPath + '.backup');
  await assert.rejects(initializeRuntimeDatabase(pool, keyPath), /root_key_missing/);
  await rename(keyPath + '.backup', keyPath);
  await chmod(keyPath, 0o644);
  await assert.rejects(initializeRuntimeDatabase(pool, keyPath), /root_key_invalid/);
  await chmod(keyPath, 0o600);
  const wrongKeyPath = join(directory, 'different-root.json');
  await writeFile(wrongKeyPath, JSON.stringify({ version: 1, key: randomBytes(32).toString('base64') }), { mode: 0o600 });
  await assert.rejects(initializeRuntimeDatabase(pool, wrongKeyPath), /root_key_mismatch/);
  await initializeRuntimeDatabase(pool, keyPath);

  const { ADT_TEST_POSTGRES_CONTAINER: container, ADT_TEST_POSTGRES_RESTORE_URL: restoreUrl } = process.env;
  if (container && restoreUrl) {
    const dump = execFileSync('docker', ['exec', container, 'pg_dump', '-U', 'adt_bootstrap', '-d', 'adt',
      '--format=custom', '--schema=adt_runtime']);
    execFileSync('docker', ['exec', '-i', container, 'pg_restore', '-U', 'adt_runtime', '-d', 'adt_restore',
      '--exit-on-error', '--no-owner', '--no-privileges'], { input: dump });
    const restoredKeyPath = join(directory, 'restored-root.json');
    await copyFile(keyPath, restoredKeyPath);
    const restoredPool = runtimePostgresPool({ connectionString: restoreUrl });
    t.after(() => restoredPool.end());
    await assert.rejects(initializeRuntimeDatabase(restoredPool, join(directory, 'missing.json')), /root_key_missing/);
    const restored = await initializeRuntimeDatabase(restoredPool, restoredKeyPath);
    const restoredDatabase = new PostgresWorkflowDatabase(restoredPool);
    const restoredVault = new D1ProviderCredentialVault(restoredDatabase, version => restored.rootKey.vaultKey(17, version),
      2, undefined, undefined, 17);
    assert.equal(await restoredVault.resolve(secret), 'rotated-credential');
    const restoredRun = await new D1WorkflowRunStorage(restoredDatabase).getRun(fixture.value.id);
    assert.equal(restoredRun.attempts[0].outputText, result.outputText);
    assert.deepEqual(await operationalSettings(restoredPool)(current), { settings, revision: 1 });
  }
});
