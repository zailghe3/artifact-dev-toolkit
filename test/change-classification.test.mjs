import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyChanges } from '../scripts/classify-changes.mjs';

test('documentation and feature-request-only changes avoid executable verification and deployment', () => {
  const docs = classifyChanges([{ filename: 'README.md' }, { filename: 'docs/ops.md' }, { filename: 'specs/000.md' }]);
  assert.equal(docs.documentation_request_only, true);
  assert.equal(docs.verify_root, false);
  assert.equal(docs.verify_runtime, false);
  assert.equal(docs.verify_runner, false);
  assert.equal(docs.deploy_worker, false);
  assert.equal(docs.apply_migrations, false);
  assert.equal(docs.publish_runtime, false);
  assert.equal(docs.publish_runner, false);

  const feature = classifyChanges([{ filename: 'requests/features/ui-001.json', status: 'added' }]);
  assert.equal(feature.has_feature_request_changes, true);
  assert.equal(feature.documentation_request_only, true);
  assert.equal(feature.deploy_cloudflare, false);
});

test('app and control-plane changes verify and deploy only the Cloudflare application', () => {
  const app = classifyChanges([{ filename: 'app/page.tsx' }]);
  assert.equal(app.verify_root, true);
  assert.equal(app.verify_app, true);
  assert.equal(app.deploy_worker, true);
  assert.equal(app.apply_migrations, true);
  assert.equal(app.deploy_cloudflare, true);
  assert.equal(app.publish_runtime, false);
  assert.equal(app.publish_runner, false);

  const library = classifyChanges([{ filename: 'lib/workflow-worker-runtime.ts' }]);
  assert.equal(library.verify_root, true);
  assert.equal(library.verify_app, true);
  assert.equal(library.verify_integration, true);
  assert.equal(library.deploy_worker, true);
  assert.equal(library.publish_runtime, false);
});

test('migrations apply schema without pretending to alter the Worker image', () => {
  const result = classifyChanges([{ filename: 'migrations/0018_example.sql', status: 'added' }]);
  assert.equal(result.verify_root, true);
  assert.equal(result.verify_app, false);
  assert.equal(result.deploy_worker, false);
  assert.equal(result.apply_migrations, true);
  assert.equal(result.deploy_cloudflare, true);
  assert.equal(result.publish_runtime, false);
  assert.equal(result.publish_runner, false);
});

test('app plus migration selects one Worker deploy with migration application', () => {
  const result = classifyChanges([{ filename: 'app/page.tsx' }, { filename: 'migrations/0018_example.sql' }]);
  assert.equal(result.deploy_worker, true);
  assert.equal(result.apply_migrations, true);
  assert.equal(result.deploy_cloudflare, true);
});

test('ADT Runtime image inputs publish Runtime but tests stay verification-only', () => {
  const source = classifyChanges([{ filename: 'adt-runtime/src/server.ts' }]);
  assert.equal(source.verify_runtime, true);
  assert.equal(source.verify_integration, true);
  assert.equal(source.smoke_runtime_image, true);
  assert.equal(source.publish_runtime, true);
  assert.equal(source.deploy_cloudflare, false);
  assert.equal(source.publish_runner, false);

  const testOnly = classifyChanges([{ filename: 'adt-runtime/test/server.test.mjs' }]);
  assert.equal(testOnly.verify_runtime, true);
  assert.equal(testOnly.publish_runtime, false);
  assert.equal(testOnly.smoke_runtime_image, false);

  const smokeOnly = classifyChanges([{ filename: 'adt-runtime/scripts/smoke-image.sh' }]);
  assert.equal(smokeOnly.verify_runtime, true);
  assert.equal(smokeOnly.smoke_runtime_image, true);
  assert.equal(smokeOnly.publish_runtime, false);
});

test('Codex Runner image inputs publish Runner without unrelated proxy smoke', () => {
  const source = classifyChanges([{ filename: 'codex-runner/src/repository-manager.ts' }]);
  assert.equal(source.verify_runner, true);
  assert.equal(source.smoke_runner_image, true);
  assert.equal(source.smoke_runner_proxy_policy, false);
  assert.equal(source.publish_runner, true);
  assert.equal(source.deploy_cloudflare, false);
  assert.equal(source.publish_runtime, false);

  const helper = classifyChanges([{ filename: 'codex-runner/git-askpass.sh' }]);
  assert.equal(helper.publish_runner, true);
  assert.equal(helper.smoke_runner_image, true);
  assert.equal(helper.smoke_runner_proxy_policy, false);

  const testOnly = classifyChanges([{ filename: 'codex-runner/test/repository-manager.test.mjs' }]);
  assert.equal(testOnly.verify_runner, true);
  assert.equal(testOnly.publish_runner, false);
  assert.equal(testOnly.smoke_runner_image, false);
  assert.equal(testOnly.smoke_runner_proxy_policy, false);
});

test('Runner release metadata is a shared Runner and ADT Worker production input', () => {
  const result = classifyChanges([{ filename: 'codex-runner/release.json' }]);
  assert.equal(result.verify_root, true);
  assert.equal(result.verify_app, true);
  assert.equal(result.verify_runner, true);
  assert.equal(result.smoke_runner_image, true);
  assert.equal(result.publish_runner, true);
  assert.equal(result.deploy_worker, true);
  assert.equal(result.apply_migrations, true);
  assert.equal(result.deploy_cloudflare, true);
});

test('normal Runner source plus release bump selects both production consumers', () => {
  const result = classifyChanges([
    { filename: 'codex-runner/src/server.ts' },
    { filename: 'codex-runner/release.json' },
  ]);
  assert.equal(result.publish_runner, true);
  assert.equal(result.deploy_worker, true);
  assert.equal(result.verify_app, true);
  assert.equal(result.verify_runner, true);
});

test('Runner proxy policy and stack configuration do not build an unchanged Runner image', () => {
  for (const filename of ['codex-runner/squid.conf', 'codex-runner/squid-executor.conf', 'codex-runner/scripts/smoke-proxy-policy.sh']) {
    const result = classifyChanges([{ filename }]);
    assert.equal(result.verify_runner, true, filename);
    assert.equal(result.smoke_runner_proxy_policy, true, filename);
    assert.equal(result.smoke_runner_image, false, filename);
    assert.equal(result.publish_runner, false, filename);
  }

  const stack = classifyChanges([{ filename: 'codex-runner/docker-stack.split.example.yml' }]);
  assert.equal(stack.verify_runner, true);
  assert.equal(stack.smoke_runner_proxy_policy, false);
  assert.equal(stack.smoke_runner_image, false);
  assert.equal(stack.publish_runner, false);
});

test('workflow, script, and root test changes use root verification without production publication', () => {
  for (const filename of [
    '.github/workflows/pr-orchestrator.yml',
    'scripts/classify-changes.mjs',
    'test/change-classification.test.mjs',
    'test-fixtures/example.txt',
  ]) {
    const result = classifyChanges([{ filename }]);
    assert.equal(result.verify_root, true, filename);
    assert.equal(result.deploy_cloudflare, false, filename);
    assert.equal(result.publish_runtime, false, filename);
    assert.equal(result.publish_runner, false, filename);
  }
});

test('root application build inputs remain Cloudflare Worker deployment inputs', () => {
  for (const filename of ['package.json', 'package-lock.json', 'next.config.ts', 'open-next.config.ts', 'wrangler.jsonc']) {
    const result = classifyChanges([{ filename }]);
    assert.equal(result.verify_root, true, filename);
    assert.equal(result.verify_app, true, filename);
    assert.equal(result.deploy_worker, true, filename);
  }
  assert.equal(classifyChanges([{ filename: 'package.json' }]).verify_integration, true);
});

test('mixed control-plane and Runtime source requires the shared integration gate and both mutations', () => {
  const result = classifyChanges([
    { filename: 'lib/adt-runtime-client.ts' },
    { filename: 'adt-runtime/src/server.ts' },
  ]);
  assert.equal(result.verify_integration, true);
  assert.equal(result.deploy_worker, true);
  assert.equal(result.publish_runtime, true);
});

test('renames classify both old and new paths and retain sensitive detection across domains', () => {
  const result = classifyChanges([
    { filename: 'docs/old.md', previous_filename: '.github/workflows/old.yml', status: 'renamed' },
    { filename: 'codex-runner/squid.conf', previous_filename: 'codex-runner/src/old.ts', status: 'renamed' },
  ]);
  assert.equal(result.has_sensitive_changes, true);
  assert.equal(result.verify_root, true);
  assert.equal(result.verify_runner, true);
  assert.equal(result.publish_runner, true);
  assert.equal(result.smoke_runner_image, true);
  assert.equal(result.smoke_runner_proxy_policy, true);
  assert.match(result.sensitive_files, /.github\/workflows\/old.yml/);
});

test('lockfile repair classification remains independent from deployment impact', () => {
  const result = classifyChanges([
    { filename: 'package.json' },
    { filename: '.nvmrc' },
    { filename: '.github/dependabot.yml' },
  ]);
  assert.equal(result.has_lockfile_repair_changes, true);
  assert.match(result.lockfile_repair_files, /package\.json/);
  assert.match(result.lockfile_repair_files, /\.nvmrc/);
  assert.match(result.lockfile_repair_files, /.github\/dependabot\.yml/);
});

test('governance files remain sensitive but non-deployable documentation', () => {
  const result = classifyChanges([
    { filename: 'AGENTS.md' },
    { filename: 'docs/subsystem/AGENTS.md' },
    { filename: '.agents/skills/code-change-verification/SKILL.md' },
  ]);
  assert.equal(result.has_sensitive_changes, true);
  assert.equal(result.documentation_request_only, true);
  assert.equal(result.deploy_cloudflare, false);
});

test('unknown paths fail closed instead of silently becoming production deployments', () => {
  const result = classifyChanges([{ filename: 'future-subsystem/config.bin' }]);
  assert.equal(result.has_unclassified_changes, true);
  assert.equal(result.unclassified_files, 'future-subsystem/config.bin');
  assert.equal(result.deploy_cloudflare, false);
  assert.equal(result.publish_runtime, false);
  assert.equal(result.publish_runner, false);
});

test('deployable_changes remains a compatibility alias for aggregate Cloudflare impact', () => {
  assert.equal(classifyChanges([{ filename: 'app/page.tsx' }]).deployable_changes, true);
  assert.equal(classifyChanges([{ filename: 'migrations/0018_example.sql' }]).deployable_changes, true);
  assert.equal(classifyChanges([{ filename: 'codex-runner/src/server.ts' }]).deployable_changes, false);
  assert.equal(classifyChanges([{ filename: 'README.md' }]).deployable_changes, false);
});
