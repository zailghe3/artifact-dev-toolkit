import { createHash, createHmac, generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(root + '/package.json');
const { Miniflare, convertV4MiniflareOptions, Response } = require('miniflare');
const config = JSON.parse(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'));
const runnerRelease = require(root + '/codex-runner/release.json');
const runtimeRelease = require(root + '/adt-runtime/release.json');

export async function createFixture(scriptPath, {
  runtimeGate, revisionGate, runtimeDelay = 0, runnerFails = false,
} = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sessionSecret = randomBytes(32).toString('base64url');
  const session = randomBytes(48).toString('hex');
  const deniedSession = randomBytes(48).toString('hex');
  const keyId = createHash('sha256').update(publicKey.export({ format: 'der', type: 'spki' })).digest('base64url');
  const calls = [];
  const options = convertV4MiniflareOptions({
    name: 'adt-local-fixture',
    scriptPath,
    modulesRoot: dirname(scriptPath),
    modules: true,
    host: '127.0.0.1',
    port: 0,
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags,
    assets: { directory: resolve(root, config.assets.directory), binding: config.assets.binding },
    d1Databases: { AUTH_SESSIONS_DB: 'adt-local-fixture-db' },
    kvNamespaces: { ARTIFACT_CATALOGUE_CACHE: 'adt-local-fixture-cache' },
    bindings: {
      GITHUB_APP_ID: '1',
      GITHUB_APP_CLIENT_ID: 'mock-client',
      GITHUB_APP_CLIENT_SECRET: 'mock-client-credential',
      GITHUB_APP_PRIVATE_KEY: privateKey.export({ format: 'pem', type: 'pkcs8' }),
      GITHUB_ARTIFACT_REPOSITORY_OWNER: 'fixture-owner',
      GITHUB_ARTIFACT_REPOSITORY_NAME: 'fixture-repository',
      ARTIFACT_REPOSITORY: 'github',
      SESSION_SECRET: sessionSecret,
      ADT_RUNTIME_BASE_URL: 'https://runtime.example.test',
      ADT_RUNTIME_AUTH_SECRET: randomBytes(32).toString('base64url'),
      ADT_RUNTIME_WRAPPING_PUBLIC_KEY: publicKey.export({ format: 'pem', type: 'spki' }),
      NODE_ENV: 'production',
    },
    async outboundService(request) {
      const { hostname, pathname } = new URL(request.url);
      const call = { hostname, pathname, method: request.method, at: performance.now() };
      calls.push(call);
      if (hostname === 'runtime.example.test' && pathname === '/v1/readiness') {
        if (runtimeGate) await runtimeGate;
        else if (runtimeDelay) await delay(runtimeDelay);
        return Response.json({
          protocolVersion: 'adt-runtime-v1',
          capabilities: ['openai-agents', 'langgraph:graph'],
          credentialWrappingKeyId: keyId,
          credentialWrappingPublicKey: publicKey.export({ format: 'pem', type: 'spki' }),
          runtimeRevision: 'a'.repeat(40),
          runtimeReleaseRevision: runtimeRelease.releaseRevision,
        });
      }
      if (hostname === 'runtime.example.test' && pathname === '/v1/management/control') {
        const command = await request.json();
        call.operation = command.operation;
        call.runnerMethod = command.method;
        const wire = result => Response.json({ protocolVersion: 'adt-runtime-v1', ok: true, result });
        if (command.operation === 'runs.list') return wire([]);
        if (command.operation === 'runner' && command.repositoryId === 42) {
          if (runnerFails) return wire({ ok: false, failure: { category: 'runner_unavailable', transport: 'fetch_error', details: {} } });
          const responses = {
            capabilities: { ...runnerRelease, runnerVersion: 'b'.repeat(40), codexAvailable: true, deviceAuth: true, jobExecution: true, releaseMetadata: 'current' },
            authStatus: { connected: true },
            controlStatus: { emergencyStopped: false, updatedAt: new Date().toISOString(), hardRestart: { attempted: false, succeeded: false }, role: 'integrated', executor: null },
            environments: [{ key: 'fixture', name: 'Fixture environment', enabled: true, ready: true, sandbox: 'read-only' }],
          };
          if (Object.hasOwn(responses, command.method)) return wire({ ok: true, result: responses[command.method] });
        }
      }
      if (hostname === 'api.github.com') {
        if (pathname.endsWith('/access_tokens')) {
          const input = await request.json();
          return Response.json({ token: 'mock-installation-token', expires_at: new Date(Date.now() + 60000).toISOString(), permissions: input.permissions });
        }
        if (pathname.endsWith('/git/ref/heads/main')) {
          if (revisionGate) await revisionGate;
          return Response.json({ object: { sha: 'c'.repeat(40) } });
        }
        if (pathname.includes('/git/trees/')) return Response.json({ tree: [], truncated: false });
        if (pathname.includes('/contents/') || pathname.endsWith('/contents')) return Response.json([]);
      }
      return Response.json({}, { status: 404 });
    },
  });
  options.workers[0].config.assets.hasUserWorker = true;
  const worker = new Miniflare({ ...options, cf: false, logRequests: false });
  try {
    const database = await worker.getD1Database('AUTH_SESSIONS_DB');
    await database.batch((await readFile(resolve(root, 'migrations/0002_rebuild_auth_sessions.sql'), 'utf8'))
      .replace(/^--.*$/gm, '').split(';').map(statement => statement.trim()).filter(Boolean).map(statement => database.prepare(statement)));
    const now = Date.now();
    for (const [id, state] of [[session, 'authorized'], [deniedSession, 'denied']]) {
      const signingKey = createHmac('sha256', sessionSecret).update('adt-web-session:v1:session-signature').digest('base64');
      const hash = createHmac('sha256', signingKey).update(id).digest('hex');
      await database.prepare(`INSERT INTO auth_sessions (id, github_id, login, expires_at, created_at, authorization_state,
        repository_owner, repository_name, repository_id, installation_id, authorization_checked_at)
        VALUES (?, 123, 'fixture-user', ?, ?, ?, 'fixture-owner', 'fixture-repository', 42, 61, ?)`)
        .bind(hash, now + 3_600_000, now, state, now).run();
    }
    // OpenNext opts out of Miniflare's buffering HTTP compression on localhost.
    const origin = new URL(await worker.ready);
    origin.hostname = 'localhost';
    return { worker, session, deniedSession, calls, origin: origin.origin };
  } catch (error) {
    await worker.dispose();
    throw error;
  }
}
