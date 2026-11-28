#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixtureCommit = 'f1'.repeat(20);
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

export function validateProbe(path, response, body, origin) {
  if (path.startsWith('/auth/')) {
    const location = new URL(response.headers.get('location') || '/', origin);
    const localOrigin = new URL(origin);
    const sameRuntime = location.protocol === localOrigin.protocol && location.port === localOrigin.port
      && ['127.0.0.1', 'localhost'].includes(location.hostname) && !location.username && !location.password;
    return response.status === 307 && sameRuntime && location.pathname === '/sign-in'
      && location.searchParams.get('error') === 'configuration' && location.searchParams.get('returnTo') === '/smoke'
      && /no-store/.test(response.headers.get('cache-control') || '');
  }
  return response.status === 200 && /text\/html/.test(response.headers.get('content-type') || '')
    && body.includes('Sign in required') && body.includes('/auth/github/start');
}

function hasSecurityHeaders(response) {
  return /\bno-store\b/.test(response.headers.get('cache-control') ?? '') &&
    response.headers.get('x-content-type-options') === 'nosniff' &&
    response.headers.get('x-frame-options') === 'DENY' &&
    ['same-origin', 'no-referrer'].includes(response.headers.get('referrer-policy'));
}

// Only this explicit environment reaches Wrangler. No inherited app/provider credentials,
// developer HOME, dotenv files, Wrangler login, production bindings, or remote resources.
export async function smokeWorker({ command, startupMs = 30000, requestMs = 3000, signal } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'adt-worker-smoke-'));
  let child, exit, spawnError, logs = '';
  const interrupted = new AbortController();
  const stop = () => interrupted.abort();
  for (const event of ['SIGINT', 'SIGTERM']) process.on(event, stop);
  signal?.addEventListener('abort', stop, { once: true });
  try {
    const port = await freePort(), origin = `http://127.0.0.1:${port}`;
    let browserOrigin = origin;
    const config = join(directory, 'wrangler.json');
    const production = JSON.parse(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'));
    await writeFile(config, JSON.stringify({
      name: 'adt-local-runtime-smoke', main: resolve(root, production.main),
      compatibility_date: production.compatibility_date, compatibility_flags: production.compatibility_flags,
      assets: { directory: resolve(root, production.assets.directory), binding: production.assets.binding },
      tsconfig: relative(directory, resolve(root, 'tsconfig.json')),
      vars: { ADT_RUNTIME_AUTH_SECRET: 'smoke-only-runtime-secret'.repeat(2), ADT_DEPLOYED_AT: '2026-11-28T09:00:00.000Z', ADT_DEPLOY_COMMIT_SHA: fixtureCommit },
    }));
    const args = command ? command(port) : [process.execPath, resolve(root, 'node_modules/wrangler/bin/wrangler.js'),
      'dev', '--local', '--config', config, '--ip', '127.0.0.1', '--port', String(port),
      '--persist-to', join(directory, 'state'), '--log-level', 'error', '--show-interactive-dev-session=false'];
    child = spawn(args[0], args.slice(1), { cwd: directory, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
      PATH: process.env.PATH, HOME: directory, XDG_CONFIG_HOME: directory, TMPDIR: directory,
      NODE_ENV: 'production', CI: 'true', WRANGLER_SEND_METRICS: 'false',
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    } });
    const collect = chunk => { logs = (logs + chunk.toString()).slice(-8192); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('exit', (code, signal) => { exit = { code, signal }; });
    child.once('error', error => { spawnError = error.code; });
    const alive = () => {
      if (interrupted.signal.aborted || signal?.aborted) throw new Error('Worker smoke interrupted');
      if (spawnError || exit) throw new Error(`Worker process stopped (${spawnError || exit.signal || exit.code})`);
    };
    const deadline = Date.now() + startupMs;
    for (const path of ['/auth/github/start?returnTo=%2Fsmoke', '/sign-in']) {
      let response, body;
      while (Date.now() < deadline) {
        alive();
        try {
          response = await fetch(origin + path, { redirect: 'manual', signal: AbortSignal.any([
            interrupted.signal, AbortSignal.timeout(Math.min(requestMs, Math.max(1, deadline - Date.now()))),
          ]) });
          body = await response.text();
          break;
        } catch { alive(); await delay(100); }
      }
      alive();
      if (!response) throw new Error('Worker startup/request deadline exceeded');
      if (!validateProbe(path, response, body, origin)) throw new Error(`Unexpected ADT response for ${path.split('?')[0]}: HTTP ${response.status}`);
      if (!hasSecurityHeaders(response) || body.includes(fixtureCommit)) throw new Error('Public authentication response security check failed');
      // Wrangler canonicalises the local browser origin to localhost. Keep the
      // transport bound to IPv4 and use the validated redirect origin for POSTs.
      if (path.startsWith('/auth/')) browserOrigin = new URL(response.headers.get('location'), origin).origin;
    }
    // Runtime/model bearer authority is never browser-session publication authority.
    for(const path of ['/api/advisor/knowledge','/api/advisor/knowledge/proposals','/api/advisor/knowledge/proposals/00000000-0000-4000-8000-000000000000']){
      const method=path==='/api/advisor/knowledge'?'GET':'POST';
      const response=await fetch(origin+path,{method,redirect:'manual',headers:{origin:browserOrigin,authorization:'Bearer smoke-runtime-authority','content-type':'application/json'},...(method==='POST'?{body:JSON.stringify({action:'publish',revision:1,confirmation:'publish',reviewToken:'model-generated-approval'})}:{}),signal:AbortSignal.any([interrupted.signal,AbortSignal.timeout(requestMs)])});
      if(response.status!==401||!hasSecurityHeaders(response))throw new Error(`Knowledge session boundary failed: HTTP ${response.status}`);
      await response.body?.cancel();
    }
    for (const [path, method] of [
      ['/api/workflow-runs?limit=1', 'GET'],
      ['/api/workflow-connections/adt-runtime/execution-path', 'POST'],
      ['/api/workflow-connections/codex-runner/status', 'GET'],
      ['/api/workflow-connections/codex-runner/diagnostics', 'GET'],
    ]) {
      const response = await fetch(origin + path, {
        method, redirect: 'manual', headers: { origin: browserOrigin, 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
        signal: AbortSignal.any([interrupted.signal, AbortSignal.timeout(requestMs)]),
      });
      if (response.status !== 401 || !hasSecurityHeaders(response)) {
        throw new Error(`Workflow diagnostics session boundary failed: HTTP ${response.status}`);
      }
      await response.body?.cancel();
    }
    const body = '{}';
    const credentialsPath = '/api/workflow-connections/example/credential';
    const brokerPath = '/api/runtime-repository-credential';
    const tests = [
      { path: '/workflows/runs', status: 307, location: '/sign-in', allowStream: true },
      { path: '/tools', status: 307, location: '/sign-in', allowStream: true },
      { path: '/api/tools/mcp', status: 401 },
      { path: '/api/workflow-runs', method: 'POST', body, status: 401 },
      { path: credentialsPath, method: 'PUT', body, status: 401 },
      { path: '/api/infrastructure-redeploy', method: 'POST', body, status: 401 },
      { path: '/api/workflow-runs', method: 'POST', body, headers: { origin: 'https://other.invalid' }, status: 403 },
      { path: '/api/advisor/knowledge/proposals', method: 'POST', body, headers: { 'sec-fetch-site': 'same-site' }, status: 403 },
      ...['device', 'logout', 'test', 'control'].flatMap(action => {
        const path = `/api/workflow-connections/codex-runner/${action}`;
        return [{ path, method: 'POST', omitOrigin: true, status: 403 },
          { path, method: 'POST', headers: { origin: 'https://other.invalid' }, status: 403 }];
      }),
      { path: credentialsPath, method: 'DELETE', body, headers: { 'content-type': 'text/plain' }, status: 415 },
      { path: brokerPath, method: 'POST', body, headers: {
        'x-adt-protocol': 'adt-runtime-v1', 'x-adt-timestamp': String(Date.now()),
        'x-adt-nonce': 'synthetic-broker-nonce', 'x-adt-signature': 'A'.repeat(43),
        'x-adt-content-sha256': createHash('sha256').update(body).digest('base64url'),
      }, status: 401 },
      { path: '/auth/github/callback?state=invalid&code=synthetic-oauth-code', status: 307, location: '/sign-in' },
      { path: `/sign-out?returnTo=${encodeURIComponent('/documents/..//other.invalid')}`, status: 307, location: '/' },
      { path: '/sign-out', method: 'POST', body: '', headers: { 'content-type': 'application/x-www-form-urlencoded' }, status: 303, location: '/' },
      { path: '/sign-out', method: 'POST', headers: { origin: 'https://other.invalid' }, status: 403 },
    ];
    // No D1 or Runtime URL is bound. Any unintended privileged dependency fails this smoke test.
    for (const probe of tests) {
      const response = await fetch(origin + probe.path, {
        method: probe.method, body: probe.body, redirect: 'manual',
        headers: { ...(probe.path === brokerPath || probe.omitOrigin ? {} : { origin: browserOrigin }), 'content-type': 'application/json', cookie: '__Host-adt_session=malformed', ...probe.headers },
        signal: AbortSignal.any([interrupted.signal, AbortSignal.timeout(requestMs)]),
      });
      // App Router can commit a loading shell before the authentication decision.
      // Its streamed HTML redirect must lead to the same local sign-in destination.
      const html = probe.allowStream && response.status === 200 ? await response.text() : '';
      const streamedLocation = /<meta\b[^>]*\bhttp-equiv="refresh"\s+content="1;url=([^"<>]+)"/.exec(html)?.[1];
      const location = response.headers.get('location') ?? streamedLocation;
      const target = location && new URL(location, origin);
      const local = target && ['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === String(port) && target.protocol === 'http:';
      if ((response.status !== probe.status && !streamedLocation) || !hasSecurityHeaders(response) || html.includes(fixtureCommit) ||
          (probe.location && (!local || target.pathname !== probe.location || target.username || target.password))) {
        throw new Error(`Worker security check failed for ${probe.method ?? 'GET'} ${probe.path.split('?')[0]}: HTTP ${response.status}`);
      }
      if (!response.bodyUsed) await response.body?.cancel();
    }
    alive();
    return { ok: true };
  } catch (error) {
    // Never echo arbitrary Worker output. Recognise the incident signature without
    // leaking response bodies, cookies, URLs, credentials, or developer paths.
    const manifest = /preview-props\.json/.test(logs) ? '; preview-props.json manifest error observed' : '';
    const build = /Build failed|Cannot find tsconfig/.test(logs) ? '; Wrangler bundling failed' : '';
    throw new Error(`${error.message}${manifest}${build}; captured ${Buffer.byteLength(logs)} bounded log bytes`);
  } finally {
    if (child?.pid) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already exited */ }
      await delay(200);
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* entire process group exited */ }
    }
    for (const event of ['SIGINT', 'SIGTERM']) process.off(event, stop);
    signal?.removeEventListener('abort', stop);
    await rm(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  smokeWorker().then(() => console.log('Local OpenNext Worker security smoke passed.'))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
