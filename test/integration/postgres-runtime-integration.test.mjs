import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer as createTcpServer } from 'node:net';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtemp, chmod, copyFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { initializeRuntimeDatabase, runtimePostgresPool } from '../../adt-runtime/dist/postgres.js';
import { PostgresWorkflowDatabase } from '../../adt-runtime/dist/workflow-database.js';
import { workflowLeases, WorkflowLeaseLost } from '../../adt-runtime/dist/workflow-leases.js';
import { D1ProviderCredentialVault } from '../../lib/provider-credential-vault.ts';
import { D1WorkflowRunStorage } from '../../lib/workflow-d1-storage.ts';
import { D1WorkflowApprovalStore } from '../../lib/workflow-approvals.ts';
import { D1LangGraphCheckpointStore } from '../../lib/langgraph-checkpoints.ts';
import { createRuntimeServer } from '../../adt-runtime/dist/server.js';
import { signature } from '../../adt-runtime/dist/protocol.js';
import { operationalSettings, recordManagementNonce } from '../../adt-runtime/dist/operational-settings.js';
import { advisorSettingsRecordSchema, codexEnvironmentInputSchema, OPERATIONAL_SETTINGS_PATH } from '../../adt-runtime/dist/operational-settings-contract.js';
import { RemoteOpenAIAgentsRuntime, requestRuntimeOperationalSettings } from '../../lib/adt-runtime-client.ts';
import { diagnoseRuntimeManagement, runtimeControl, WORKFLOW_HISTORY_LIMIT } from '../../lib/runtime-service-client.ts';
import { nativeFixture } from '../support/native-adt-fixture.mjs';
import { run as workflowRun } from '../support/advisor-fixtures.mjs';

const connectionString = process.env.ADT_TEST_POSTGRES_URL;

async function verifyProductionStartup(t, keyPath, pool) {
  let brokerUp = true;
  let runnerReply;
  const runner = createHttpServer((request, response) => {
    if (request.url === '/api/runtime-repository-credential') {
      request.resume();
      const value = brokerUp
        ? { ok: true, result: { token: 'fixture-github-token', expiresAt: '2027-01-01', permissions: { contents: 'read' } } }
        : { ok: false, code: 'github_broker_unavailable' };
      return response.writeHead(brokerUp ? 200 : 503, { 'content-type': 'application/json' })
        .end(JSON.stringify({ protocolVersion: 'adt-runtime-v1', ...value }));
    }
    if (request.headers['x-codex-runner-secret'] !== 'fixture-runner-secret') return response.writeHead(401).end();
    if (request.url === '/v1/capabilities' && runnerReply) {
      return response.writeHead(runnerReply.status, { 'content-type': 'application/json', ...runnerReply.headers })
        .end(JSON.stringify(runnerReply.body));
    }
    const value = request.url === '/v1/capabilities'
      ? { protocolVersion: 1, runnerVersion: 'a'.repeat(40), runnerRevision: 19, codexVersion: '0.159.3',
          codexAvailable: false, deviceAuth: false, jobExecution: true }
      : request.url === '/v1/auth/status' ? { connected: true, authMode: 'chatgpt' } : undefined;
    response.writeHead(value ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(value));
  }).listen(0, '127.0.0.1');
  await once(runner, 'listening');
  t.after(() => runner.close());
  const reservation = createTcpServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const { port } = reservation.address();
  await new Promise(resolve => reservation.close(resolve));
  const db = new URL(connectionString);
  const authSecret = 'postgres-production-startup-test'.repeat(2);
  const child = spawn(process.execPath, [new URL('../../adt-runtime/dist/server.js', import.meta.url).pathname], { env: {
    ADT_RUNTIME_HOST: '127.0.0.1', ADT_RUNTIME_PORT: String(port), ADT_RUNTIME_AUTH_SECRET: authSecret,
    ADT_RUNTIME_DB_HOST: db.hostname, ADT_RUNTIME_DB_PORT: db.port, ADT_RUNTIME_DB_NAME: db.pathname.slice(1),
    ADT_RUNTIME_DB_USER: decodeURIComponent(db.username), ADT_RUNTIME_DB_PASSWORD: decodeURIComponent(db.password),
    ADT_RUNTIME_ROOT_KEY_FILE: keyPath,
    ADT_RUNTIME_WORKER_URL: `http://127.0.0.1:${runner.address().port}`,
    CODEX_RUNNER_BASE_URL: `http://127.0.0.1:${runner.address().port}`,
    CODEX_RUNNER_ACCESS_CLIENT_ID: 'fixture-client-id', CODEX_RUNNER_ACCESS_CLIENT_SECRET: 'fixture-client-secret',
    CODEX_RUNNER_SHARED_SECRET: 'fixture-runner-secret',
  } });
  const closed = once(child, 'close');
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let diagnostic = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-32_768); });
  const target = `http://127.0.0.1:${port}`;
  let proxyMode = 'forward';
  const proxy = createHttpServer((request, response) => {
    if (!request.url.startsWith('/runtime/')) return response.writeHead(404).end();
    const path = request.url.slice('/runtime'.length);
    if (proxyMode === 'html' && request.method === 'POST') {
      request.resume();
      setTimeout(() => response.writeHead(502, { 'content-type': 'text/html' }).end('<html>private upstream prompt</html>'), 30);
      return;
    }
    const headers = { ...request.headers };
    if (proxyMode === 'strip-signature' && request.method === 'POST') delete headers['x-adt-signature'];
    if (proxyMode === 'unsupported-protocol' && request.method === 'POST') {
      headers['x-adt-protocol'] = 'adt-runtime-v2';
      headers['x-adt-signature'] = signature(authSecret, request.method, path,
        headers['x-adt-timestamp'], headers['x-adt-nonce'], headers['x-adt-content-sha256'], headers['x-adt-protocol']);
    }
    const upstream = httpRequest(new URL(path, target), { headers, method: request.method }, forwarded => {
      response.writeHead(forwarded.statusCode, forwarded.headers);
      forwarded.pipe(response);
    });
    upstream.on('error', () => response.writeHead(502).end());
    request.pipe(upstream);
  }).listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const baseUrl = `http://127.0.0.1:${proxy.address().port}/runtime`;
  const config = { baseUrl, authSecret };
  const scope = { repositoryId: 123, installationId: 12, owner: 'fixture', repository: 'artifacts', branch: 'main', root: 'artifacts' };
  const list = { operation: 'runs.list', repositoryId: scope.repositoryId, limit: 1 };
  const readiness = () => new RemoteOpenAIAgentsRuntime(config).diagnose();
  try {
    let ready = false;
    for (let attempt = 0; attempt < 160 && child.exitCode === null; attempt++) {
      ready = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(500) }).then(response => response.ok, () => false);
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.equal(ready, true, diagnostic);
    assert.equal((await readiness()).readinessAccepted, true);
    const vault = (method, ...args) => runtimeControl(config, {
      operation: 'vault', repositoryId: scope.repositoryId, method, arguments: args,
    });
    await assert.rejects(vault('hasCredential', 'private-invalid-vault-id'), error =>
      error.code === 'vault_secret_id_invalid' && error.observation.httpStatus === 400 &&
      error.observation.result === 'operation_rejected' && error.observation.dispatched &&
      /^[\w-]{32}$/.test(error.observation.requestId));
    const secret = await vault('create', 'private-vault-value');
    try {
      assert.equal(await vault('hasCredential', secret), true);
      await pool.query('UPDATE provider_credential_vault SET encrypted_credential=$1 WHERE secret_id=$2',
        ['private-corrupt-ciphertext', secret]);
      await assert.rejects(vault('hasCredential', secret), error =>
        error.code === 'runtime_unavailable' && error.observation.httpStatus === 503);
    } finally {
      await vault('delete', secret);
    }

    for (const [connectionType, configuration, code] of [
      ['openai-responses', { unexpected: true }, 'provider_configuration_invalid'],
      ['ollama-chat', { baseUrl: 'private-invalid-endpoint', authMode: 'none' }, 'ollama_configuration_invalid'],
    ]) {
      await assert.rejects(runtimeControl(config, { operation: 'provider', repositoryId: scope.repositoryId,
        request: { action: 'models', connectionType, configuration, credentials: { source: 'input' } },
      }), error => error.code === code && error.observation.httpStatus === 422 && error.observation.result === 'operation_rejected');
    }

    assert.deepEqual(await runtimeControl(config, list), []);
    const good = await diagnoseRuntimeManagement(config, scope);
    assert.equal(good.management.result, 'ok');
    assert.equal(good.management.dispatched, true);
    assert.equal(good.workflowHistory.result, 'ok');
    assert.notEqual(good.management.requestId, good.workflowHistory.requestId);
    assert.equal(good.dependencies.postgres.status, 'available');
    assert.equal(good.dependencies.checkpoints.status, 'available');
    assert.equal(good.dependencies.workflow.status, 'available');
    assert.equal(good.dependencies.broker.status, 'available');
    assert.doesNotMatch(JSON.stringify(good), /fixture-github-token/);
    brokerUp = false;
    const optionalFailure = await diagnoseRuntimeManagement(config, scope);
    assert.equal(optionalFailure.management.result, 'ok');
    assert.equal(optionalFailure.dependencies.workflow.status, 'available');
    assert.equal(optionalFailure.dependencies.broker.status, 'unavailable');

    const runnerCaps = await runtimeControl(config, { operation: 'runner', repositoryId: scope.repositoryId, method: 'capabilities', arguments: [] });
    const runnerAuth = await runtimeControl(config, { operation: 'runner', repositoryId: scope.repositoryId, method: 'authStatus', arguments: [] });
    assert.equal(runnerCaps.result.codexAvailable, false);
    assert.equal(runnerAuth.result.connected, true);
    for (const [status, body, headers, code, managementStatus] of [
      [401, {}, {}, 'runner_unauthorized', 502],
      [403, {}, { 'cf-ray': 'fixture' }, 'access_denied', 502],
      [503, {}, {}, 'runner_unavailable', 503],
      [200, {}, {}, 'invalid_response', 502],
      [200, { protocolVersion: 2, runnerVersion: 'a'.repeat(40), codexAvailable: false, deviceAuth: false, jobExecution: true },
        {}, 'runner_update_required', 409],
    ]) {
      runnerReply = { status, body, headers };
      await assert.rejects(runtimeControl(config, { operation: 'runner.release' }), error =>
        error.code === code && error.observation.httpStatus === managementStatus &&
        error.observation.result === 'operation_rejected');
    }
    runnerReply = undefined;
    await assert.rejects(runtimeControl(config, { operation: 'runs.diagnose', repositoryId: 7, scope }), error =>
      error.message === 'permission_denied' && error.observation.httpStatus === 403 && error.observation.dispatched === true);

    proxyMode = 'strip-signature';
    const rejected = await diagnoseRuntimeManagement(config, scope);
    assert.equal(rejected.management.result, 'authentication_failed');
    assert.equal(rejected.management.httpStatus, 401);
    assert.equal(rejected.management.authenticated, false);
    assert.equal(rejected.management.dispatched, false);
    assert.equal(rejected.dependencies.workflow.status, 'not_verified');
    assert.equal(rejected.workflowHistory.result, 'authentication_failed');
    await assert.rejects(runtimeControl(config, list), error =>
      error.code === 'runtime_authentication_failed' && error.observation.httpStatus === 401 &&
      error.observation.stage === 'authentication' && /^[\w-]{32}$/.test(error.observation.requestId));
    assert.equal((await readiness()).readinessAccepted, true);

    proxyMode = 'unsupported-protocol';
    const incompatible = await diagnoseRuntimeManagement(config, scope);
    assert.equal(incompatible.management.result, 'protocol_incompatible');
    assert.equal(incompatible.workflowHistory.httpStatus, 409);
    await assert.rejects(runtimeControl(config, list), error =>
      error.code === 'protocol_incompatible' && error.observation.httpStatus === 409 &&
      error.observation.authenticated === true && error.observation.protocolCompatible === false &&
      /^[\w-]{32}$/.test(error.observation.requestId));

    proxyMode = 'html';
    const malformed = await diagnoseRuntimeManagement(config, scope);
    assert.equal(malformed.management.result, 'malformed_response');
    assert.equal(malformed.management.httpStatus, 502);
    assert.ok(malformed.management.elapsedMs >= 25);
    assert.equal(malformed.management.authenticated, null);
    assert.equal(malformed.dependencies.postgres.status, 'not_verified');
    assert.doesNotMatch(JSON.stringify(malformed), /private upstream prompt/);
    proxyMode = 'forward';

    await pool.query('REVOKE INSERT ON management_request_nonces FROM CURRENT_USER');
    try {
      assert.equal((await readiness()).readinessAccepted, true);
      const nonce = await diagnoseRuntimeManagement(config, scope);
      assert.equal(nonce.management.result, 'nonce_persistence_unavailable');
      assert.equal(nonce.management.httpStatus, 503);
      assert.equal(nonce.management.authenticated, true);
      assert.equal(nonce.management.protocolCompatible, true);
      assert.equal(nonce.management.dispatched, false);
      assert.equal(nonce.dependencies.workflow.status, 'not_verified');
      await assert.rejects(runtimeControl(config, list), error =>
        error.code === 'nonce_persistence_unavailable' && error.observation.result === 'nonce_persistence_unavailable');
    } finally {
      await pool.query('GRANT INSERT ON management_request_nonces TO CURRENT_USER');
    }

    await pool.query('REVOKE SELECT ON workflow_runs FROM CURRENT_USER');
    try {
      const storage = await diagnoseRuntimeManagement(config, scope);
      assert.equal(storage.management.dispatched, true);
      assert.equal(storage.dependencies.postgres.status, 'available');
      assert.equal(storage.dependencies.workflow.status, 'unavailable');
      assert.equal(storage.dependencies.workflow.result, 'storage_query_unavailable');
      assert.equal(storage.workflowHistory.httpStatus, 503);
      await assert.rejects(runtimeControl(config, list), error =>
        error.code === 'storage_query_unavailable' && error.observation.result === 'storage_query_unavailable');
      assert.doesNotMatch(JSON.stringify(storage), /SELECT|permission denied for table|fixture-runner-secret|private upstream prompt/);
    } finally {
      await pool.query('GRANT SELECT ON workflow_runs TO CURRENT_USER');
    }
    assert.deepEqual(await runtimeControl(config, list), []);
    const storage = new D1WorkflowRunStorage(new PostgresWorkflowDatabase(pool), undefined, scope.repositoryId);
    const older = { ...workflowRun({ repositoryContext: scope }), status: 'succeeded', createdAt: '2026-01-01T00:00:00Z' };
    const newest = { ...workflowRun({ repositoryContext: scope }), status: 'succeeded', createdAt: '2026-01-02T00:00:00Z' };
    await storage.createRun(older);
    await storage.createRun(newest);
    await pool.query('UPDATE workflow_runs SET agent_snapshots_json = $1 WHERE id = $2',
      [JSON.stringify({ damaged: 'private malformed snapshot' }), older.id]);
    try {
      assert.deepEqual((await runtimeControl(config, list)).map(run => run.id), [newest.id]);
      await assert.rejects(runtimeControl(config, { ...list, limit: WORKFLOW_HISTORY_LIMIT }), { code: 'storage_data_invalid' });
      const damagedHistory = await diagnoseRuntimeManagement(config, scope);
      assert.equal(damagedHistory.management.result, 'ok');
      assert.equal(damagedHistory.workflowHistory.result, 'storage_data_invalid');
      assert.equal(damagedHistory.dependencies.postgres.status, 'available');
      assert.equal(damagedHistory.dependencies.workflow.status, 'unavailable');
      assert.doesNotMatch(JSON.stringify(damagedHistory), /private malformed snapshot|SENSITIVE_INPUT/);
      const isolated = await diagnoseRuntimeManagement(config, { ...scope, repositoryId: scope.repositoryId + 1 });
      assert.equal(isolated.dependencies.workflow.status, 'available');
    } finally {
      await pool.query('DELETE FROM workflow_runs WHERE id IN ($1, $2)', [newest.id, older.id]);
    }
    assert.match(diagnostic, new RegExp(`"requestId":"${good.management.requestId}"`));
    assert.match(diagnostic, new RegExp(`"requestId":"${good.workflowHistory.requestId}"`));
    assert.doesNotMatch(diagnostic, /SELECT|permission denied for table|fixture-runner-secret|fixture-client-secret|fixture-github-token|private upstream prompt|private malformed snapshot|SENSITIVE_INPUT/);
    assert.doesNotMatch(diagnostic, /private-invalid-vault-id|private-vault-value|private-corrupt-ciphertext|private-invalid-endpoint|vault_decryption_failed/);
  } finally {
    proxy.close();
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 4000);
    await closed;
    clearTimeout(timer);
  }
}

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
  await verifyProductionStartup(t, keyPath, pool);
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

test('signed launches run inside PostgreSQL-backed Runtime and approvals survive replacement', {
  skip: !connectionString && 'Set ADT_TEST_POSTGRES_URL to a disposable PostgreSQL database',
  timeout: 60_000,
}, async t => {
  const { createServer } = await import('node:http');
  const { createRuntimeApplication } = await import('../../adt-runtime/dist/workflow-application.js');
  const { runtimeControl } = await import('../../lib/runtime-service-client.ts');
  const { run, agent, connection, context, workflow } = await import('../support/advisor-fixtures.mjs');
  const { compileWorkflowV2ExecutionPlan, workflowDefinitionV2Schema } = await import('../../lib/workflow-definitions.ts');
  const directory = await mkdtemp(join(tmpdir(), 'adt-coordinator-'));
  // The test script provides a fresh second database after the backup verification.
  const primary = new URL(connectionString);
  primary.pathname = '/adt_coordinator';
  const pool = runtimePostgresPool({ connectionString: primary.href });
  t.after(async () => { await pool.end(); await rm(directory, { recursive: true }); });
  const installation = await initializeRuntimeDatabase(pool, join(directory, 'root.json'));
  const authSecret = 'postgres-execution-runtime-auth'.repeat(2);
  const keys = generateKeyPairSync('rsa', {
    modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });
  let brokerRequests = 0;
  const broker = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const value = JSON.parse(body);
    assert.equal(value.purpose, 'artifacts');
    assert.deepEqual(value.context, context);
    brokerRequests++;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ protocolVersion: 'adt-runtime-v1', ok: true, result: {
      token: 'test-installation-read-token', expiresAt: new Date(Date.now() + 60_000).toISOString(), permissions: { contents: 'read' },
    } }));
  });
  await new Promise(resolve => broker.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => broker.close(resolve)));
  const stages = [];
  const env = { ADT_RUNTIME_WORKER_URL: `http://127.0.0.1:${broker.address().port}`,
    ADT_RUNTIME_AUTH_SECRET: authSecret, ADT_RUNTIME_WRAPPING_PUBLIC_KEY: keys.publicKey };
  const providerRequests = [];
  const storedOpenAI = 'stored-openai-integration-credential';
  const storedAnthropic = 'stored-anthropic-integration-credential';
  const applicationOptions = { pool, ...installation, env, onError: stage => stages.push(stage),
    providerFetcher: async (url, init) => {
      const target = new URL(url), headers = new Headers(init.headers);
      providerRequests.push(target.hostname + target.pathname);
      if (target.hostname === 'api.openai.com') {
        assert.equal(headers.get('authorization'), `Bearer ${storedOpenAI}`);
        if (target.pathname === '/v1/responses') {
          return Response.json({ status: 'completed', output: [{ type: 'message', role: 'assistant',
            content: [{ type: 'output_text', text: storedOpenAI }] }] });
        }
        assert.equal(target.pathname, '/v1/models');
        return Response.json({ data: [{ id: 'gpt-5' }, { id: storedOpenAI }] });
      }
      assert.equal(target.hostname, 'api.anthropic.com');
      assert.equal(headers.get('authorization'), `Bearer ${storedAnthropic}`);
      if (target.pathname === '/v1/models/claude-sonnet-4-5') return Response.json({ id: 'claude-sonnet-4-5' });
      assert.equal(target.pathname, '/v1/models');
      return Response.json({ data: [{ id: 'claude-sonnet-4-5' }, { id: storedAnthropic }], has_more: false });
    },
  };
  let application = createRuntimeApplication(applicationOptions);
  let turns = 0;
  const runtime = await createRuntimeServer({
    host: '127.0.0.1', port: 0, authSecret, privateKeyPem: keys.privateKey,
    revision: 'postgres-coordinator', control: command => application.store(command),
    recordManagementNonce: (nonce, timestamp) => recordManagementNonce(pool, nonce, timestamp), logger() {},
    providerHttp: { fetcher: async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${storedOpenAI}`);
      turns++;
      const tool = turns === 1;
      if (turns === 2) assert.match(JSON.stringify(body), /"?tokens/);
      return Response.json({ id: `chat-${turns}`, object: 'chat.completion', created: 1, model: 'gpt-5',
        usage: { prompt_tokens: 12, completion_tokens: 3 }, choices: [{ index: 0, finish_reason: tool ? 'tool_calls' : 'stop',
          message: tool ? { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function',
            function: { name: 'adt_execution_metrics', arguments: '{}' } }] } :
            { role: 'assistant', content: 'Analysis completed with recorded metrics.' } }] });
    } },
  });
  await runtime.listen();
  t.after(async () => { await application.stop(); await runtime.close(); });
  env.ADT_RUNTIME_BASE_URL = `http://127.0.0.1:${runtime.server.address().port}`;
  const config = { baseUrl: env.ADT_RUNTIME_BASE_URL, authSecret };
  await assert.rejects(runtimeControl(config, { operation: 'runner.release' }), error =>
    error.code === 'configuration_missing' && error.observation.httpStatus === 503 &&
    error.observation.result === 'operation_rejected');
  const { runtimeProviderClient, runtimeProviderConnectionStore } = await import('../../lib/runtime-provider-client.ts');
  const { resolveWorkflowRunConnectionSnapshot } = await import('../../lib/workflow-run-connection-snapshots.ts');
  const { createWorkIqPrivateBundle, parseWorkIqPrivateBundle, serializeWorkIqPrivateBundle } = await import('../../lib/work-iq-auth.ts');
  const createCredential = credential => runtimeControl(config, {
    operation: 'vault', repositoryId: context.repositoryId, method: 'create', arguments: [credential],
  });
  const secret = await createCredential(storedOpenAI);
  const anthropicSecret = await createCredential(storedAnthropic);
  const workIqSecret = await createCredential(serializeWorkIqPrivateBundle({
    ...parseWorkIqPrivateBundle(createWorkIqPrivateBundle('stored-work-iq-client-secret')),
    refreshToken: 'stored-work-iq-refresh-token', authorizationContextId: `ctx_${'x'.repeat(43)}`,
  }));
  const definitions = [
    { fileSha: 'openai-sha', definition: { id: connection.key, name: 'Agents', runtime: 'openai-agents', model: 'gpt-5',
      credential: { secretRef: secret } } },
    { fileSha: 'anthropic-sha', definition: { id: 'anthropic', name: 'Anthropic', runtime: 'anthropic-messages', model: 'claude-sonnet-4-5',
      credential: { secretRef: anthropicSecret } } },
    { fileSha: 'work-iq-sha', definition: { id: 'work-iq', name: 'Work IQ', runtime: 'work-iq-rest',
      configuration: { tenantId: '11111111-1111-4111-8111-111111111111', clientId: '22222222-2222-4222-8222-222222222222' }, credential: { secretRef: workIqSecret } } },
  ];
  const client = runtimeProviderClient(context.repositoryId, async command => {
    assert.equal(command.repositoryId, context.repositoryId);
    assert.doesNotMatch(JSON.stringify(command), /stored-(openai|anthropic|work-iq)/);
    const result = await runtimeControl(config, command);
    assert.doesNotMatch(JSON.stringify(result), /stored-(openai|anthropic|work-iq)/);
    return result;
  });
  const store = runtimeProviderConnectionStore({
    listConnections: async () => definitions,
    getConnection: async key => definitions.find(item => item.definition.id === key),
  }, client);
  const [openai, anthropic, workIq] = await store.listSafeDescriptors();
  for (const item of [openai, anthropic, workIq]) assert.equal(item.enabled, true);
  assert.deepEqual(await client.listSaved(openai, openai.adapter), ['gpt-5']);
  assert.deepEqual(await client.listSaved(anthropic, anthropic.adapter), ['claude-sonnet-4-5']);
  await client.validateSaved(openai, openai.adapter, 'gpt-5');
  await client.validateSaved(anthropic, anthropic.adapter, 'claude-sonnet-4-5');
  assert.deepEqual(await store.testConnection(openai.key), { ok: true, outputText: 'Provider connection verified.' });
  assert.equal(providerRequests.filter(path => path === 'api.anthropic.com/v1/models/claude-sonnet-4-5').length, 2);
  assert.equal((await resolveWorkflowRunConnectionSnapshot(workIq, store)).authorizationContextId, workIq.authorizationContextId);
  const foreign = await runtimeControl(config, { operation: 'provider', repositoryId: context.repositoryId + 1,
    request: { action: 'describe', connections: [openai] } });
  assert.deepEqual(foreign, [{ enabled: false, configured: false }]);
  for (const method of ['resolve', 'resolveWithRevision', 'resolveMcpServerCredential', 'resolveSecurityProfileCredential']) {
    await assert.rejects(runtimeControl(config, { operation: 'vault', repositoryId: context.repositoryId,
      method, arguments: [secret] }), /invalid_request/);
  }
  const selected = { ...agent, tools: ['adt_execution_metrics'] };
  const frozen = await resolveWorkflowRunConnectionSnapshot(openai, store);
  const value = run({ agents: [selected], connections: [frozen],
    executionPlan: compileWorkflowV2ExecutionPlan(workflow, [selected]), clientIdempotencyKey: 'advisor-runtime-only',
    advisorContext: { version: 1, readOnly: true, override: null } });
  await runtimeControl(config, { operation: 'runs.launch', repositoryId: context.repositoryId, snapshot: value });
  const leases = workflowLeases(pool);
  const interrupted = await leases.claim();
  assert.equal(interrupted.id, value.id);
  assert.equal(await leases.claim(), undefined);
  await pool.query("UPDATE workflow_runs SET execution_lease_until=clock_timestamp() WHERE id=$1", [value.id]);
  const recovery = await leases.claim();
  assert.equal(recovery.id, value.id);
  assert.notEqual(recovery.fence, interrupted.fence);
  const stale = new PostgresWorkflowDatabase(pool, client => leases.guard(client, interrupted));
  await assert.rejects(stale.prepare("UPDATE workflow_runs SET status='failed' WHERE id=?").bind(value.id).run(), WorkflowLeaseLost);
  await leases.release(interrupted, 0);
  assert.equal(await leases.claim(), undefined);
  await leases.release(recovery, 0);
  application.start();

  async function waitFor(id, statuses) {
    let detail;
    for (let attempts = 0; attempts < 100; attempts++) {
      await new Promise(resolve => setTimeout(resolve, 120));
      detail = await runtimeControl(config, { operation: 'runs.detail', repositoryId: context.repositoryId, runId: id });
      if (statuses.includes(detail.run.status) || detail.run.status === 'failed') break;
    }
    return detail;
  }
  const detail = await waitFor(value.id, ['succeeded']);
  assert.equal(detail.run.status, 'succeeded', JSON.stringify({ stages, detail, turns }));
  assert.equal(detail.run.finalOutput, 'Analysis completed with recorded metrics.');
  assert.equal(turns, 2);
  assert.equal(brokerRequests, 2);
  assert.equal(await runtimeControl(config, { operation: 'runs.detail', repositoryId: context.repositoryId + 1, runId: value.id }), null);
  const ownHistory = await runtimeControl(config, { operation: 'runs.list', repositoryId: context.repositoryId, limit: 1 });
  assert.equal(ownHistory[0].id, value.id);
  assert.deepEqual(await runtimeControl(config, { operation: 'runs.list', repositoryId: context.repositoryId + 1, limit: 1 }), []);

  const approvalWorkflow = workflowDefinitionV2Schema.parse({
    ...workflow, id: 'approval-flow',
    nodes: [workflow.nodes[0], { id: 'approve', blockType: 'approval', blockVersion: 1, config: { message: 'Continue?' } },
      { ...workflow.nodes[0], id: 'finish' }],
    edges: [{ id: 'to-approve', source: 'analyse', target: 'approve' }, { id: 'to-finish', source: 'approve', target: 'finish' }],
  });
  const approvalPlan = compileWorkflowV2ExecutionPlan(approvalWorkflow, [selected]);
  const approvalRuns = ['approve-after-restart', 'cancel-after-restart'].map(clientIdempotencyKey =>
    run({ workflow: approvalWorkflow, agents: [selected], connections: [{ ...connection, credentialSecretRef: secret }],
      executionPlan: approvalPlan, clientIdempotencyKey }));
  const command = (operation, id, fields = {}) => runtimeControl(config, {
    operation, repositoryId: context.repositoryId, runId: id, ...fields,
  });
  await Promise.all(approvalRuns.map(snapshot => runtimeControl(config, {
    operation: 'runs.launch', repositoryId: context.repositoryId, snapshot,
  })));
  const waiting = await Promise.all(approvalRuns.map(({ id }) => waitFor(id, ['waiting_approval'])));
  for (const detail of waiting) assert.equal(detail.run.status, 'waiting_approval', JSON.stringify({ stages, detail }));
  const brokerClaim = { operation: 'broker.claim', nonce: 'a-broker-nonce-for-replay-test', timestamp: Date.now() };
  assert.equal(await runtimeControl(config, brokerClaim), true);
  await application.stop();
  const inspection = await command('runs.inspection', approvalRuns[0].id, { actor: 'reviewer' });
  await command('runs.approval', approvalRuns[0].id, { approvalRequestId: inspection.approval.requestId });
  await command('runs.cancel', approvalRuns[1].id);
  application = createRuntimeApplication(applicationOptions);
  assert.equal(await runtimeControl(config, brokerClaim), false);
  application.start();
  const [approved, cancelled] = await Promise.all([
    waitFor(approvalRuns[0].id, ['succeeded']), waitFor(approvalRuns[1].id, ['cancelled']),
  ]);
  assert.equal(approved.run.status, 'succeeded', JSON.stringify({ stages, approved }));
  assert.equal(cancelled.run.status, 'cancelled', JSON.stringify({ stages, cancelled }));
  assert.equal(turns, 5);

});
