import assert from 'node:assert/strict';
import test from 'node:test';
import { startDiagnosticObservations } from '../lib/diagnostic-observations.ts';
import { controlPlaneDiagnosticDomain, operationalOverall, runtimeDiagnosticDomain } from '../lib/operational-diagnostics.ts';

test('passive observations start concurrently, isolate errors, and reuse shared work', async () => {
  const started = [];
  const slowRuntime = Promise.withResolvers();
  const repository = { generatedAt: new Date().toISOString() };
  const observations = startDiagnosticObservations({
    repository: async () => { started.push('repository'); return repository; },
    runner: async () => { started.push('runner'); throw new Error('private upstream error'); },
    runtime: () => { started.push('runtime'); return slowRuntime.promise; },
  });

  assert.deepEqual(started.sort(), ['repository', 'runner', 'runtime']);
  const [auth, catalogue, runner] = await Promise.all([observations.repository, observations.repository, observations.runner]);
  assert.equal(auth, catalogue);
  assert.equal(auth.value, repository);
  assert.equal(runner.value, null);
  assert.doesNotMatch(JSON.stringify(runner), /private upstream/);

  const runtime = { configured: false };
  slowRuntime.resolve(runtime);
  assert.equal((await observations.runtime).value, runtime);
});

test('overall health stays pending until required observations have completed', () => {
  const domains = [controlPlaneDiagnosticDomain(false)];
  assert.equal(operationalOverall(domains, 3).state, 'pending');
  assert.equal(operationalOverall([...domains, runtimeDiagnosticDomain()], 1).state, 'pending');
  assert.equal(operationalOverall([...domains, runtimeDiagnosticDomain()]).state, 'failed');
  assert.equal(operationalOverall(domains).state, 'healthy');
});
