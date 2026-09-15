import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('infrastructure freshness authorizes before probing protected infrastructure', async () => {
  const route = await readFile(new URL('../app/api/infrastructure-freshness/route.ts', import.meta.url), 'utf8');
  const authorization = route.indexOf('requireApiDiagnosticsAccess(request)');
  const collection = route.indexOf('getInfrastructureFreshnessSnapshot()');
  assert.ok(authorization >= 0);
  assert.ok(collection >= 0);
  assert.ok(authorization < collection);
  assert.match(route, /noStoreHeaders/);
});
