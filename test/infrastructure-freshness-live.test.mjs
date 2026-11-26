import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { installTsxHook } from './render-tsx.mjs';

const requireTsx = installTsxHook();
const { releaseRevision } = requireTsx('../adt-runtime/release.json');
const { protocolVersion, runnerRevision } = requireTsx('../codex-runner/release.json');
const origin = 'https://adt.example';

function fixture(outcome = 'accepted') {
 const probes = [];
 const calls = { readiness: 0, redeploy: 0 };
 const services = {
  diagnoseADTRuntime: async () => {
   calls.readiness++;
   return probes.shift() ?? { protocolCompatible: true, runtimeReleaseRevision: releaseRevision };
  },
  workflowRuntimeCommand: async () => ({ protocolVersion, runnerRevision, runnerVersion: 'a'.repeat(40) }),
  redeployInfrastructure: async target => {
   assert.equal(target, 'runtime');
   calls.redeploy++;
   return { state: outcome, message: 'Fixture redeploy result' };
  },
 };
 const originalLoad = Module._load;
 Module._load = function (request, parent, isMain) {
  if (request === '@/lib/auth') {
   return { requireApiDiagnosticsAccess: async () => ({}), requireApiRepositoryAccess: async () => ({}) };
  }
  if (request === './workflow-services.ts' || request === '@/lib/workflow-services') return services;
  return originalLoad.call(this, request, parent, isMain);
 };
 let GET, POST, invalidateInfrastructureFreshnessCache;
 try {
  const livePath = requireTsx.resolve('../lib/infrastructure-freshness-live.ts');
  const freshnessPath = requireTsx.resolve('../app/api/infrastructure-freshness/route.ts');
  const redeployPath = requireTsx.resolve('../app/api/infrastructure-redeploy/route.ts');
  for (const path of [livePath, freshnessPath, redeployPath]) delete requireTsx.cache[path];
  ({ GET } = requireTsx(freshnessPath));
  ({ POST } = requireTsx(redeployPath));
  ({ invalidateInfrastructureFreshnessCache } = requireTsx(livePath));
 } finally {
  Module._load = originalLoad;
 }
 return {
  calls,
  deferObservation() {
   const { promise, resolve } = Promise.withResolvers();
   probes.push(promise);
   return state => resolve(state === 'unknown' ? { protocolCompatible: false } : {
    protocolCompatible: true,
    runtimeReleaseRevision: state === 'current' ? releaseRevision : releaseRevision - 1,
    redeployTargets: ['runtime'],
   });
  },
  get: async (forced = false) => {
   const response = await GET(new Request(`${origin}/api/infrastructure-freshness${forced ? '?refresh=1' : ''}`));
   assert.equal(response.status, 200);
   assert.match(response.headers.get('cache-control'), /no-store/);
   const snapshot = await response.json();
   return snapshot.components.runtime.state;
  },
  post: () => POST(new Request(`${origin}/api/infrastructure-redeploy`, {
   method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{"target":"runtime"}',
  })),
  invalidate: invalidateInfrastructureFreshnessCache,
 };
}

for (const newerFirst of [false, true]) {
 test(`the Worker caches the newer observation with ${newerFirst ? 'forced' : 'ordinary'} response first`, async () => {
  const f = fixture();
  const ordinary = f.deferObservation();
  const forced = f.deferObservation();
  const olderRead = f.get();
  const newerRead = f.get(true);
  if (newerFirst) {
   forced('current');
   assert.equal(await newerRead, 'current');
   ordinary('superseded');
  } else {
   ordinary('superseded');
   assert.equal(await olderRead, 'superseded');
   forced('current');
  }
  await Promise.all([olderRead, newerRead]);
  assert.equal(await f.get(), 'current');
  assert.equal(f.calls.readiness, 2);
 });
}

test('an older Worker response cannot replace an unavailable forced observation with current', async () => {
 const f = fixture();
 const ordinary = f.deferObservation();
 const forced = f.deferObservation();
 const olderRead = f.get();
 const newerRead = f.get(true);
 forced('unknown');
 assert.equal(await newerRead, 'unknown');
 ordinary('current');
 await olderRead;
 assert.equal(await f.get(), 'unknown');
 assert.equal(f.calls.readiness, 2);
});

for (const outcome of ['accepted', 'ambiguous']) {
 test(`an older Worker request cannot overwrite freshness after an ${outcome} redeploy response`, async () => {
  const f = fixture(outcome);
  const ordinary = f.deferObservation();
  const eligibility = f.deferObservation();
  const olderRead = f.get();
  const action = f.post();
  eligibility('superseded');
  assert.equal((await action).status, outcome === 'accepted' ? 202 : 502);
  assert.equal(f.calls.redeploy, 1);

  ordinary(outcome === 'accepted' ? 'superseded' : 'current');
  await olderRead;
  assert.equal(await f.get(), outcome === 'accepted' ? 'current' : 'superseded');
  assert.equal(f.calls.readiness, outcome === 'accepted' ? 3 : 2);
 });
}

test('Worker invalidation detaches an ordinary read and fences a pending forced observation', async () => {
 const f = fixture();
 const ordinary = f.deferObservation();
 const forced = f.deferObservation();
 const olderRead = f.get();
 const olderForced = f.get(true);
 await Promise.resolve();
 assert.equal(f.calls.readiness, 2);
 f.invalidate();

 const currentRead = f.get();
 await Promise.resolve();
 assert.equal(f.calls.readiness, 3);
 assert.equal(await currentRead, 'current');
 ordinary('superseded');
 forced('superseded');
 await Promise.all([olderRead, olderForced]);
 assert.equal(await f.get(), 'current');
 assert.equal(f.calls.readiness, 3);
});
