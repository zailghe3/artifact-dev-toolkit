import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const sha = '73c6c1c41f2e87a9070ef4fd62a00421d8ad2fcf';
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'adrian-provenance-'));
  const root = join(dir, 'root');
  const upstream = join(dir, `Adrian-${sha}`);
  mkdirSync(join(root, 'third_party'), { recursive: true });
  mkdirSync(upstream);
  cpSync('third_party/adrian', join(root, 'third_party/adrian'), { recursive: true });
  cpSync('third_party/adrian/backend', join(upstream, 'backend'), { recursive: true });
  cpSync('third_party/adrian/LICENSE', join(upstream, 'LICENSE'));
  cpSync('third_party/adrian-upstream.json', join(root, 'third_party/adrian-upstream.json'));
  const archive = join(dir, 'upstream.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', dir, `Adrian-${sha}`]);
  return { dir, root, archive };
}
function verify(root, archive) {
  return spawnSync('scripts/verify-adrian-provenance.sh', [root], { encoding: 'utf8', env: { ...process.env, ADRIAN_PROVENANCE_ARCHIVE: archive } });
}

test('provenance verifier accepts the exact backend and licence and rejects divergence', () => {
  const f = fixture();
  try {
    assert.equal(verify(f.root, f.archive).status, 0);
    writeFileSync(join(f.root, 'third_party/adrian/backend/go.mod'), `${readFileSync(join(f.root, 'third_party/adrian/backend/go.mod'))}\n`);
    assert.notEqual(verify(f.root, f.archive).status, 0);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('provenance verifier rejects redirectable repository metadata and added files', () => {
  const f = fixture();
  try {
    const metadata = JSON.parse(readFileSync(join(f.root, 'third_party/adrian-upstream.json')));
    metadata.repository = 'attacker/Adrian';
    writeFileSync(join(f.root, 'third_party/adrian-upstream.json'), JSON.stringify(metadata));
    assert.notEqual(verify(f.root, f.archive).status, 0);
    cpSync('third_party/adrian-upstream.json', join(f.root, 'third_party/adrian-upstream.json'));
    writeFileSync(join(f.root, 'third_party/adrian/added.txt'), 'unexpected');
    assert.notEqual(verify(f.root, f.archive).status, 0);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
