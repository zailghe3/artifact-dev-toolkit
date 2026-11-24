import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const entry = fileURLToPath(new URL('../dist/server.js', import.meta.url));
const start = environment => promisify(execFile)(process.execPath, [entry], {
  timeout: 12_000,
  env: {
    ADT_RUNTIME_AUTH_SECRET: 'startup-test-service-authentication-secret'.repeat(2),
    ADT_RUNTIME_HOST: '127.0.0.1',
    ...environment,
  },
});

for (const [name, environment, code] of [
  ['no database configuration', {}, 'postgres_configuration_missing'],
  ['incomplete database configuration', { ADT_RUNTIME_DB_HOST: 'db' }, 'postgres_configuration_invalid'],
  ['database initialization fails', {
    ADT_RUNTIME_DB_HOST: '127.0.0.1', ADT_RUNTIME_DB_PORT: '1', ADT_RUNTIME_DB_NAME: 'adt',
    ADT_RUNTIME_DB_USER: 'runtime', ADT_RUNTIME_DB_PASSWORD: 'startup-test-db',
    ADT_RUNTIME_ROOT_KEY_FILE: '/keys/root.json',
  }, 'postgres_unavailable'],
]) {
  test(`production Runtime refuses to listen when ${name}`, async () => {
    await assert.rejects(start(environment), error => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, '');
      assert.equal(JSON.parse(error.stderr.trim()).stage, code);
      return true;
    });
  });
}
