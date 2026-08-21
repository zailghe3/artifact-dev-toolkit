import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isDocumentationOrRequestPath } from '../scripts/classify-changes.mjs';

const expectedSkills = [
  'code-change-verification',
  'feature-request-creation',
  'implementation-strategy',
  'spec-sync',
];

function parseSkillFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'Skill must start with YAML frontmatter');
  const fields = Object.fromEntries(match[1].split('\n').map((line) => {
    const separator = line.indexOf(':');
    assert.ok(separator > 0, `Invalid Skill frontmatter line: ${line}`);
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
  }));
  return fields;
}

test('repository contains the architecture map and expected repo-local skills', () => {
  assert.equal(existsSync('ARCHITECTURE.md'), true);
  assert.equal(existsSync('.agents/skills'), true);
  assert.deepEqual(readdirSync('.agents/skills').sort(), expectedSkills);
});

test('repo-local skills have valid minimal metadata and unique directory-matching names', () => {
  const names = new Set();
  for (const directory of expectedSkills) {
    const skillPath = join('.agents', 'skills', directory, 'SKILL.md');
    const frontmatter = parseSkillFrontmatter(readFileSync(skillPath, 'utf8'));
    assert.equal(frontmatter.name, directory);
    assert.ok(frontmatter.description?.length > 20, `${directory} needs a useful description`);
    assert.equal(names.has(frontmatter.name), false, `duplicate Skill name: ${frontmatter.name}`);
    names.add(frontmatter.name);
  }
});

test('repo-local skills are non-deployable documentation inputs', () => {
  for (const directory of expectedSkills) {
    assert.equal(isDocumentationOrRequestPath(`.agents/skills/${directory}/SKILL.md`), true);
  }
});
