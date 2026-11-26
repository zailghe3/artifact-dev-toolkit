import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the run page and API route delegate to the same repository-scoped Runtime loader', async () => {
  const [page, route] = await Promise.all([
    readFile(new URL('../app/(application)/workflows/runs/[runId]/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/workflow-runs/[runId]/route.ts', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(page,/raw provider body|authorization|cookie/i);
  assert.match(page,/CopyButton text=\{run\.initialInput\} compact label="run input"/);
  assert.match(page,/CopyButton text=\{attempt\.outputText\} compact label=\{`raw output for \${step\.name}`\}/);
  assert.doesNotMatch(page,/CopyButton text=\{attempt\.inputText|CopyButton text=\{run\.finalOutput/);
  for (const source of [page, route]) {
    assert.match(source, /import \{getWorkflowRunDetail\} from "@\/lib\/workflow-run-detail"/);
    assert.match(source, /await getWorkflowRunDetail\(/);
    assert.doesNotMatch(source, /reconcileWorkflowLaunch|getWorkflowRunStorage/);
  }
});
