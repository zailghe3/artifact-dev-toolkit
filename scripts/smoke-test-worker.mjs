#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';

const root = fileURLToPath(new URL('../', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
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
    const config = join(directory, 'wrangler.json');
    const production = JSON.parse(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'));
    await writeFile(config, JSON.stringify({
      name: 'adt-local-runtime-smoke', main: resolve(root, production.main),
      compatibility_date: production.compatibility_date, compatibility_flags: production.compatibility_flags,
      assets: { directory: resolve(root, production.assets.directory), binding: production.assets.binding },
      tsconfig: relative(directory, resolve(root, 'tsconfig.json')),
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
  smokeWorker().then(() => console.log('Local OpenNext Worker OAuth and sign-in smoke passed.'))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
