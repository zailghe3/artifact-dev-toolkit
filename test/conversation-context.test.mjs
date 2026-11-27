import assert from 'node:assert/strict';
import test from 'node:test';
import { CONVERSATION_CONTEXT_LOOKBACK, CONVERSATION_SUMMARY_BATCH_SIZE, conversationContextSettings, planConversationContext } from '../lib/conversation-context.ts';
import { conversationSubmissionSchema, MAX_CONVERSATION_INPUT_BYTES } from '../adt-runtime/src/conversation-contract.ts';

const item = (ordinal, response, message = `Question ${ordinal}`) => ({ ordinal, id: crypto.randomUUID(), message, response, sections: [], complete: true });
const makeContext = (exchanges, message, exactTurnIds = [], historyBytes = 2400, totalSucceeded = exchanges.length,
  previousSummary, turnId = 'next-turn') => {
  const ordered = [...exchanges].sort((a, b) => a.ordinal - b.ordinal);
  const history = [...new Set([...ordered.slice(-CONVERSATION_CONTEXT_LOOKBACK), ...ordered.filter(item => exactTurnIds.includes(item.id))])];
  const rollingCandidates = ordered.filter(item => item.ordinal > (previousSummary?.throughOrdinal ?? 0)).slice(0, CONVERSATION_SUMMARY_BATCH_SIZE);
  return planConversationContext({ history, rollingCandidates, previousSummary, totalSucceeded, turnId, message,
    exactTurnIds, settings: { historyBytes, recentTurns: 2 } });
};

test('recent and explicitly selected exchanges enter the Workflow in order with original whitespace and code', () => {
  const original = '  Write code\r\n\r\n';
  const code = '~~~ts\r\n\tconst value = "🔭";  \r\n~~~';
  const old = item(1, 'Distinct final summary.  ', original);
  old.sections = [{ id: 'knowledge-section-id', label: 'Audit finding', markdown: code, complete: true, terminal: false }];
  const recent = item(3, '  Answer\n', '\nRecent user text  ');
  const message = 'Now reuse the original.  \n';
  const context = makeContext([recent, old], message, [old.id]).assemble();
  assert.ok(context.initialInput.includes(original));
  assert.ok(context.initialInput.includes(code));
  assert.ok(context.initialInput.includes(old.response));
  assert.ok(context.initialInput.includes('Response section Audit finding [knowledge-section-id]'));
  assert.ok(context.initialInput.includes(recent.message));
  assert.ok(context.initialInput.includes(recent.response));
  assert.ok(context.initialInput.indexOf('Turn 1') < context.initialInput.indexOf('Turn 3'));
  assert.ok(context.initialInput.endsWith(message));
  assert.match(context.initialInput, /untrusted reference data/);
  assert.deepEqual(context.metadata.exactTurnIds, [old.id, recent.id]);
  assert.equal(context.metadata.summary, undefined);
});

test('bounded long history records deterministic excerpts, provider provenance and explicit omissions', () => {
  const history = Array.from({ length: 14 }, (_, index) => item(index + 1, `Observation ${index + 1}. ${'🔭'.repeat(130)}`));
  const plan = makeContext(history, 'What did we decide?', [], 2200, 21);
  const local = plan.assemble();
  assert.equal(local.metadata.version, 2);
  assert.deepEqual(local.metadata.exactTurnIds, history.slice(-2).map(value => value.id));
  assert.equal(local.metadata.summary.method, 'extractive');
  assert.ok(local.metadata.summary.turns.length > 0);
  assert.ok(local.metadata.omittedHistory >= 7);
  assert.match(local.initialInput, /Some prior successful exchanges are absent/);
  assert.ok(Buffer.byteLength(local.initialInput) <= 2200 + Buffer.byteLength('What did we decide?'));
  assert.deepEqual(local, makeContext(history.slice().reverse(), 'What did we decide?', [], 2200, 21).assemble());
  const source = { provider: 'openai-agents', model: 'gpt-5', connectionKey: 'agents' };
  const provider = plan.assemble({ source, text: 'The older turns considered two options.' });
  assert.equal(provider.metadata.summary.detailsOmitted, false);
  assert.deepEqual(provider.metadata.summary, { ...local.metadata.summary, method: 'provider', source, detailsOmitted: false,
    text: 'The older turns considered two options.' });
  assert.ok(provider.initialInput.includes(provider.metadata.summary.text));
  assert.deepEqual(plan.assemble({ source, text: '🚀'.repeat(3000) }), local);
});

test('rolling summaries preserve old decisions, record lineage, and skip unchanged coverage', () => {
  const history = Array.from({ length: 44 }, (_, index) => item(index + 1, `Evidence ${index + 1}. ${'a'.repeat(75)}`));
  history[0].message = 'Decision SIGMA: retain the original case.';
  let summary;
  for (let i = 1; i <= history.length; i++) {
    const plan = makeContext(history.slice(0, i), 'Next', [], 1500, i, summary, `next-${i}`);
    const old = summary;
    summary = plan.assemble().metadata.summary;
    if (summary?.updatedByTurnId === `next-${i}` && old) {
      assert.equal(summary.previousSummaryTurnId, old.updatedByTurnId);
      assert.ok(summary.throughOrdinal > old.throughOrdinal);
      assert.match(plan.providerInput, /Prior rolling summary.*\n/);
    }
  }
  assert.ok(summary.throughOrdinal > CONVERSATION_CONTEXT_LOOKBACK);
  assert.match(summary.text, /Decision SIGMA/);
  const repeatedPlan = makeContext(history, 'Next', [], 1500, history.length, summary);
  assert.equal(repeatedPlan.providerInput, '');
  assert.equal(repeatedPlan.assemble().metadata.summary, summary);
  const requested = makeContext(history, 'Refer to the first decision', [history[0].id], 1500, history.length, summary).assemble();
  assert.ok(requested.initialInput.includes(history[0].response));
  assert.ok(requested.metadata.exactTurnIds.includes(history[0].id));
  const noRoom = makeContext(history, 'x'.repeat(MAX_CONVERSATION_INPUT_BYTES), [], 1500, history.length, summary).assemble();
  assert.equal(noRoom.metadata.summaryIncluded, false);
  assert.ok(noRoom.metadata.summary.text.includes('Decision SIGMA'));
  assert.equal(noRoom.metadata.omittedHistory, history.length);
});

test('an essential earlier exchange is either retained whole or rejected clearly', () => {
  const older = item(1, '🔭'.repeat(3000));
  const recent = item(2, 'recent answer');
  assert.throws(() => makeContext([recent, older], 'follow up', [older.id]), /conversation_context_too_large/);
  assert.throws(() => makeContext([recent], 'follow up', [older.id]), /conversation_reference_unavailable/);
  const partial = { ...recent, complete: false, sections: [{ id: 'large-section', label: 'Large output', markdown: 'first excerpt',
    complete: false, terminal: false }] };
  assert.throws(() => makeContext([partial], 'follow up', [partial.id]), /conversation_context_too_large/);
  const limited = makeContext([partial], 'Summarise the output').assemble();
  assert.equal(limited.metadata.summaryIncluded, true);
  assert.equal(limited.metadata.summary.detailsOmitted, true);
  const message = 'a'.repeat(MAX_CONVERSATION_INPUT_BYTES);
  const onlyPrompt = makeContext([recent], message).assemble();
  assert.equal(onlyPrompt.initialInput, message);
  assert.equal(onlyPrompt.metadata.omittedHistory, 1);
  assert.deepEqual(conversationContextSettings({ ADT_CONVERSATION_HISTORY_BYTES: '999999', ADT_CONVERSATION_RECENT_TURNS: '2' }),
    { historyBytes: 24000, recentTurns: 2 });
  const valid = { conversationId: crypto.randomUUID(), turnId: crypto.randomUUID(), after: null, target: { kind: 'agent', id: 'example' }, message };
  assert.equal(conversationSubmissionSchema.safeParse(valid).success, true);
  for (const bad of ['   ', '\u0000text', '\ud800', '🔭'.repeat(MAX_CONVERSATION_INPUT_BYTES / 4 + 1)]) {
    assert.equal(conversationSubmissionSchema.safeParse({ ...valid, message: bad }).success, false);
  }
});
