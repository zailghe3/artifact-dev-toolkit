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

test('request lifecycle metadata changes orchestration, not the rendered implementation contract', () => {
  const planned = validateFeatureRequestData({ ...baseRequest, requestStatus: 'planned' });
  const ready = validateFeatureRequestData({ ...baseRequest, requestStatus: 'ready' });
  assert.equal(planned, ready);
  assert.doesNotMatch(planned, /requestStatus/);
  for (const value of [
    baseRequest.objective,
    baseRequest.userContext,
    baseRequest.currentBehaviour,
    baseRequest.requiredBehaviour,
    ...baseRequest.functionalRequirements,
    ...baseRequest.acceptanceCriteria,
  ]) assert.ok(planned.includes(value), `rendered issue omitted request contract value: ${value}`);
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
