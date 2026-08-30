import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyChanges } from '../scripts/classify-changes.mjs';

test('detects canonical feature request changes and skips deployment for feature-only changes', () => {
  const result = classifyChanges([{ filename: 'requests/features/ui-001.json', status: 'added' }]);
  assert.equal(result.has_feature_request_changes, true);
  assert.equal(result.deployable_changes, false);
});

test('detects sensitive renamed previous filenames', () => {
  const result = classifyChanges([{ filename: 'docs/old.md', previous_filename: '.github/workflows/old.yml', status: 'renamed' }]);
  assert.equal(result.has_sensitive_changes, true);
  assert.match(result.sensitive_files, /.github\/workflows\/old.yml/);
});

test('deploys runtime-relevant root config changes', () => {
  const result = classifyChanges([{ filename: 'next.config.ts', status: 'modified' }]);
  assert.equal(result.deployable_changes, true);
  assert.equal(result.documentation_request_only, false);
});

test('skips deployment only for narrow documentation and request-only changes', () => {
  const result = classifyChanges([{ filename: 'README.md' }, { filename: 'docs/ops.md' }, { filename: 'specs/000.md' }]);
  assert.equal(result.documentation_request_only, true);
  assert.equal(result.deployable_changes, false);
});

test('detects lockfile repair relevant package and toolchain changes', () => {
  const result = classifyChanges([
    { filename: 'package.json' },
    { filename: '.nvmrc' },
    { filename: '.github/dependabot.yml' },
  ]);
  assert.equal(result.has_lockfile_repair_changes, true);
  assert.match(result.lockfile_repair_files, /package\.json/);
  assert.match(result.lockfile_repair_files, /\.nvmrc/);
  assert.match(result.lockfile_repair_files, /\.github\/dependabot\.yml/);
});

test('does not require lockfile repair for unrelated source changes', () => {
  const result = classifyChanges([{ filename: 'app/page.tsx' }]);
  assert.equal(result.has_lockfile_repair_changes, false);
  assert.equal(result.lockfile_repair_files, '');
});

test('classifies migrations as production-affecting and not documentation-only', () => {
  const result = classifyChanges([{ filename: 'migrations/0002_rebuild_auth_sessions.sql', status: 'added' }]);
  assert.equal(result.deployable_changes, true);
  assert.equal(result.documentation_request_only, false);
});

test('classifies governance-only changes as sensitive but non-deployable documentation', () => {
  const result = classifyChanges([
    { filename: 'AGENTS.md' },
    { filename: 'docs/subsystem/AGENTS.md' },
    { filename: '.agents/skills/code-change-verification/SKILL.md' },
    { filename: '.agents/config/settings.json' },
  ]);

  assert.equal(result.has_sensitive_changes, true);
  assert.equal(result.documentation_request_only, true);
  assert.equal(result.deployable_changes, false);
});

test('classifies Runtime publisher dependencies as sensitive', () => {
  const library = classifyChanges([{ filename: 'lib/format-date.ts' }]);
  assert.equal(library.has_sensitive_changes, true);
  assert.equal(library.documentation_request_only, false);
  assert.equal(library.deployable_changes, true);

  const integrationTest = classifyChanges([{ filename: 'test/integration/workflow-runtime-integration.test.mjs' }]);
  assert.equal(integrationTest.has_sensitive_changes, true);
});

test('does not classify ordinary UI files as sensitive', () => {
  const result = classifyChanges([{ filename: 'app/page.tsx' }, { filename: 'components/example.tsx' }]);
  assert.equal(result.has_sensitive_changes, false);
});
