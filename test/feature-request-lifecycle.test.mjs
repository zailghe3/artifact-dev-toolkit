import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { requestStatusFor, validateFeatureRequestData } from '../scripts/feature-request-validation.mjs';
import { processRequests } from '../scripts/create-feature-issues-from-requests.mjs';

const baseRequest = {
  requestId: 'test-feature-lifecycle',
  featureId: 'TEST-001',
  objective: 'Preserve a durable feature outcome until it is ready for implementation.',
  userContext: 'Maintainers may plan features before predecessor implementation details are known.',
  currentBehaviour: 'Feature requests are being planned before implementation.',
  requiredBehaviour: 'The durable outcome can be recorded without forcing immediate issue creation.',
  functionalRequirements: [
    'A planned request remains a valid canonical record.',
    'A ready request is eligible for implementation issue creation.',
  ],
  acceptanceCriteria: [
    'Planned requests validate without creating an issue.',
    'Promoting the same request to ready makes it eligible for issue creation.',
  ],
};

test('legacy feature requests without requestStatus remain ready', () => {
  assert.equal(requestStatusFor(baseRequest), 'ready');
  assert.doesNotThrow(() => validateFeatureRequestData(baseRequest));
});

test('planned and ready are the only accepted request lifecycle values', () => {
  assert.equal(requestStatusFor({ ...baseRequest, requestStatus: 'planned' }), 'planned');
  assert.equal(requestStatusFor({ ...baseRequest, requestStatus: 'ready' }), 'ready');
  assert.throws(
    () => validateFeatureRequestData({ ...baseRequest, requestStatus: 'blocked' }),
    /Invalid requestStatus: expected one of planned, ready/,
  );
});

test('request lifecycle metadata is not copied into the implementation issue body', () => {
  const rendered = validateFeatureRequestData({ ...baseRequest, requestStatus: 'planned' });
  assert.doesNotMatch(rendered, /## Request status/i);
  assert.doesNotMatch(rendered, /requestStatus/);
  assert.match(rendered, /## Current gap at planning time/);
  assert.match(rendered, /## Behavioural requirements and invariants/);
  assert.match(rendered, /## Technical constraints/);
  assert.match(rendered, /## Implementation context — revalidate against current main/);
});

test('rendered implementation contract requires current-main preflight', () => {
  const rendered = validateFeatureRequestData({ ...baseRequest, requestStatus: 'ready' });
  assert.match(rendered, /already satisfies the binding feature contract/);
  assert.match(rendered, /issue needs re-baselining/);
  assert.match(rendered, /superseded by or conflicts with newer canonical product requirements/);
  assert.match(rendered, /do not recreate obsolete implementation mechanics/);
});

test('planned requests skip issue lookup and become eligible after promotion', () => {
  const requestId = `test-planned-${process.pid}`;
  const requestPath = `requests/features/${requestId}.json`;
  const planned = {
    ...baseRequest,
    requestId,
    featureId: 'TEST-002',
    requestStatus: 'planned',
  };

  writeFileSync(requestPath, `${JSON.stringify(planned, null, 2)}\n`);
  try {
    let ghCalls = 0;
    const plannedResults = processRequests([requestPath], {
      ghExec: () => {
        ghCalls += 1;
        throw new Error('planned request must not query or mutate GitHub issues');
      },
    });
    assert.equal(plannedResults.length, 1);
    assert.equal(plannedResults[0].status, 'planned');
    assert.equal(ghCalls, 0);

    writeFileSync(requestPath, `${JSON.stringify({ ...planned, requestStatus: 'ready' }, null, 2)}\n`);
    const readyResults = processRequests([requestPath], {
      dryRun: true,
      ghExec: (args) => {
        ghCalls += 1;
        if (args[0] === 'issue' && args[1] === 'list') return '[]';
        throw new Error(`unexpected gh args: ${args.join(' ')}`);
      },
    });
    assert.equal(readyResults.length, 1);
    assert.equal(readyResults[0].status, 'would-create');
    assert.equal(ghCalls, 1);
  } finally {
    rmSync(requestPath, { force: true });
  }
});
