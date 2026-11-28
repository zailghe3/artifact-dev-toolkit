import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { initializeRuntimeDatabase, runtimePostgresPool } from '../../adt-runtime/dist/postgres.js';
import { createRuntimeServer } from '../../adt-runtime/dist/server.js';
import { createRuntimeApplication } from '../../adt-runtime/dist/workflow-application.js';
import { recordManagementNonce } from '../../adt-runtime/dist/operational-settings.js';
import { conversationRunKey } from '../../adt-runtime/src/conversation-contract.ts';
import { compileWorkflowV2ExecutionPlan } from '../../lib/workflow-definitions.ts';
import { compareActivityPosition, compareContentPosition, reconcileEvidenceWindow } from '../../lib/workflow-evidence-window.ts';
import { newLangGraphWorkflowRun } from '../../lib/workflow-storage.ts';
import { runtimeControl } from '../../lib/runtime-service-client.ts';
import { agent, connection, context } from '../support/advisor-fixtures.mjs';

const databaseUrl = process.env.ADT_TEST_POSTGRES_URL;
const actor = { githubId: 27, login: 'reviewer' };
const definitions = new URL('../../test-fixtures/interactive-workflows/', import.meta.url);
const loadWorkflow = async name => JSON.parse(await readFile(new URL(name + '.workflow.json', definitions), 'utf8'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('Interactive Workflows persist real checkpoints, recover responses and publish visible content', {
  skip: !databaseUrl && 'Set ADT_TEST_POSTGRES_URL with a disposable adt_interactions database',
  timeout: 120_000,
}, async () => {
  const url = new URL(databaseUrl);
  url.pathname = '/adt_interactions';
  const pool = runtimePostgresPool({ connectionString: url.href });
  const directory = await mkdtemp(join(tmpdir(), 'adt-interactions-'));
  const authSecret = 'postgres-interaction-fixture-signing-key'.repeat(2);
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const env = { ADT_RUNTIME_AUTH_SECRET: authSecret, ADT_RUNTIME_WRAPPING_PUBLIC_KEY: publicKey,
    ADT_CONVERSATION_HISTORY_BYTES: '9000' };
  const stages = [];
  const inputs = [];
  let application, runtime, releaseChallenger, challengerGate, malformed = false;
  const selectedNarrative = '# EVIDENCE-ROUTE\r\n\r\nLead with measured results.  \r\n';
  const optionSet = {
    message: 'Choose the evidence sequence.',
    options: [
      { id: 'evidence-first', title: 'Evidence first', description: 'Lead with measured evidence.', value: selectedNarrative },
      { id: 'story-first', title: 'Story first', description: 'Unselected customer framing.', value: 'UNSELECTED-ROUTE' },
    ],
  };
  const originalDraft = '# Working draft\r\n\r\nFirst pass.  \r\n';
  const confirmed = '# Edited draft\r\n\r\n`exact` text.  \r\n';
  const provider = async (_url, init) => {
    const body = JSON.parse(init.body);
    const instructions = body.messages.find(message => ['system','developer'].includes(message.role)).content;
    const input = body.messages.findLast(message => message.role === 'user').content;
    inputs.push({ instructions, input });
    let content;
    switch (instructions) {
      case 'framer': content = 'Audience and objective: directors deciding funding.'; break;
      case 'router': content = malformed ? '```json\n[]\n```' : JSON.stringify(optionSet); break;
      case 'architect': content = input.includes('REVISE: YES') ? '# Draft 2\n\nRevised proposal' : '# Draft 1\n\nOpening proposal'; break;
      case 'challenger':
        if (challengerGate) { await challengerGate; challengerGate = undefined; }
        content = input.includes('Draft 1') ? 'Add a concrete example.\nREVISE: YES' : 'REVISE: NO';
        break;
      case 'deliver': content = '# Final narrative\n\nReady for review.'; break;
      case 'drafter': content = originalDraft; break;
      case 'left': content = 'Left branch output'; break;
      case 'right': content = 'Right branch output'; break;
      default:
        assert.match(instructions, /^Summarise earlier chat exchanges/);
        content = 'Earlier exchanges covered the selected draft approach.';
    }
    return Response.json({ id: `interaction-fixture-${inputs.length}`, object: 'chat.completion', created: 1, model: 'gpt-5',
      usage: { prompt_tokens: 12, completion_tokens: 8 },
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] });
  };

  try {
    const installation = await initializeRuntimeDatabase(pool, join(directory, 'root.json'));
    const options = { pool, ...installation, env, providerFetcher: provider, onError: stage => stages.push(stage) };
    application = createRuntimeApplication(options);
    runtime = await createRuntimeServer({ host: '127.0.0.1', port: 0, authSecret, privateKeyPem: privateKey,
      revision: 'postgres-interactions', control: command => application.store(command),
      recordManagementNonce: (nonce, timestamp) => recordManagementNonce(pool, nonce, timestamp),
      providerHttp: { fetcher: provider }, logger() {} });
    await runtime.listen();
    env.ADT_RUNTIME_BASE_URL = `http://127.0.0.1:${runtime.server.address().port}`;
    const config = { baseUrl: env.ADT_RUNTIME_BASE_URL, authSecret };
    const command = (operation, fields = {}, repositoryId = context.repositoryId) => runtimeControl(config, { operation, repositoryId, ...fields });
    const secret = await command('vault', { method: 'create', arguments: ['disposable-fixture-key'] });
    const agents = ['framer', 'router', 'architect', 'challenger', 'deliver', 'drafter', 'left', 'right'].map(id => ({
      ...agent, id, name: id, tools: [], toolApproval: 'risk_based', masterPrompt: id, prompt: { source: 'custom', text: id },
    }));
    const prepare = (workflow, initialInput, conversation) => newLangGraphWorkflowRun({
      id: crypto.randomUUID(), workflow, revision: 'interactive-definition', executionPlan: compileWorkflowV2ExecutionPlan(workflow, agents),
      agents, connections: [{ ...connection, credentialSecretRef: secret }], initialInput, repositoryContext: context,
      executionPolicy: workflow.executionPolicy, clientIdempotencyKey: conversation && conversationRunKey(conversation),
    });
    const launch = async (workflow, input, conversation) => {
      const snapshot = prepare(workflow, input, conversation);
      const launched = await command('runs.launch', { snapshot, conversation, interactionVersion: 1 });
      return launched.runId ?? launched.run.id;
    };
    const makeTurn = (workflow, message, previous) => ({
      conversationId: previous?.conversation.id ?? crypto.randomUUID(), turnId: crypto.randomUUID(),
      after: previous?.head ?? null, message, target: { kind: 'workflow', id: workflow.id }, exactTurnIds: [],
    });
    const thread = id => command('conversations.detail', { scope: context, id });
    const inspect = runId => command('runs.detail', { runId });
    const content = (runId, before) => command('runs.content', { runId, scope: context, before });
    const activity = (runId, before) => command('runs.activity', { runId, scope: context, before });
    const outputs = runId => command('runs.outputs', { runId, scope: context });
    const cancel = async runId => {
      await command('runs.cancel', { runId });
      await wait(runId, detail => detail.run.status === 'cancelled');
    };
    const reply = (runId, requestId, response, respondent = actor) =>
      command('runs.interaction', { runId, scope: context, requestId, submission: { actor: respondent, response } });
    const wait = async (runId, match) => {
      let detail;
      for (let attempt = 0; attempt < 160; attempt++) {
        detail = await inspect(runId);
        if (match(detail)) return detail;
        if (detail.run.status === 'failed') break;
        await pause(65);
      }
      assert.fail(JSON.stringify({ runId, status: detail?.run.status, failure: detail?.run.failureMessage, stages, checkpoint: detail?.content?.active?.id }));
    };
    const request = async (runId, kind, differentFrom) =>
      (await wait(runId, run => run.content?.active?.request.kind === kind && run.content.active.id !== differentFrom)).content.active;

    application.start();
    const slide = { ...await loadWorkflow('slide-narrative'), id: 'advisor', executionPolicy: 'read-only' };
    const firstTurn = makeTurn(slide, 'Outline slides for a funding decision.');
    const slideId = await launch(slide, firstTurn.message, firstTurn);
    let decision = await request(slideId, 'decision');
    assert.equal(decision.request.question, optionSet.message);
    assert.deepEqual(decision.request.options, optionSet.options);
    assert.equal((await thread(firstTurn.conversationId)).awaitingToolReview, false);
    assert.equal((await activity(slideId)).entries[0].state, 'waiting');
    await assert.rejects(reply(slideId, decision.id, { kind: 'decision', optionId: 'other' }), { code: 'interaction_response_invalid' });
    await assert.rejects(command('runs.approval', { runId: slideId, approvalRequestId: decision.id }), { code: 'approval_not_pending' });
    await assert.rejects(command('runs.interaction', { runId: slideId, requestId: decision.id, scope: { ...context, branch: 'other' } }),
      { code: 'run_not_found' });
    await assert.rejects(command('runs.interaction', { runId: slideId, requestId: decision.id, scope: { ...context, repositoryId: 91 } }, 91),
      { code: 'run_not_found' });

    await application.stop();
    application = createRuntimeApplication(options);
    assert.deepEqual((await content(slideId)).active, decision);
    await pool.query(`UPDATE workflow_runs SET created_at=created_at-interval '36 hours' WHERE id=$1`, [slideId]);
    await pool.query(`UPDATE workflow_approvals SET requested_at=requested_at-interval '36 hours' WHERE request_id=$1`, [decision.id]);
    const chosen = { kind: 'decision', optionId: 'evidence-first', guidance: 'Lead with Q3 figures.  \n' };
    const duplicates = await Promise.all([reply(slideId, decision.id, chosen), reply(slideId, decision.id, chosen)]);
    assert.ok(duplicates.every(item => !item.actionable && item.responder === actor.login));
    assert.deepEqual(duplicates[0], duplicates[1]);
    await assert.rejects(reply(slideId, decision.id, { kind: 'decision', optionId: 'story-first' }), { code: 'interaction_response_conflict' });
    await assert.rejects(reply(slideId, decision.id, chosen, { githubId: 28, login: 'other' }), { code: 'interaction_response_conflict' });
    await application.stop();
    application = createRuntimeApplication(options);
    challengerGate = new Promise(resolve => { releaseChallenger = resolve; });
    application.start();
    await wait(slideId, detail => detail.run.status === 'running' && detail.content?.items.some(item => item.kind === 'display'));
    const early = (await thread(firstTurn.conversationId)).turns[0];
    assert.equal(early.status, 'running');
    assert.deepEqual(early.content.items.map(item => item.kind), ['interaction', 'display']);
    assert.equal(early.content.items[1].section.markdown, '# Draft 1\n\nOpening proposal');
    assert.equal(early.sections.length, 0);
    releaseChallenger();
    const slideDone = await wait(slideId, detail => detail.run.status === 'succeeded');
    assert.equal(slideDone.run.finalOutput, '# Final narrative\n\nReady for review.');
    assert.equal(inputs.filter(item => item.instructions === 'router').length, 1);
    const architectInput = inputs.find(item => item.instructions === 'architect').input;
    assert.match(architectInput, /EVIDENCE-ROUTE.*Lead with Q3 figures/);
    assert.match(architectInput, /Audience and objective/);
    assert.doesNotMatch(architectInput, /UNSELECTED-ROUTE/);
    const displays = slideDone.content.items.filter(item => item.kind === 'display').map(item => item.section);
    assert.deepEqual(displays.map(item => item.markdown), ['# Draft 1\n\nOpening proposal', '# Draft 2\n\nRevised proposal']);
    assert.equal(new Set(displays.map(item => item.id)).size, 2);
    const activityDone = await activity(slideId);
    assert.ok(activityDone.completed > slide.nodes.length);
    assert.deepEqual(activityDone.entries.filter(item => item.nodeId === 'revise').map(item => item.route).sort(), ['false', 'true']);
    for (const exact of [false, true]) {
      const nextTurn = makeTurn(slide, 'Tell me why we chose this route.', await thread(firstTurn.conversationId));
      if (exact) nextTurn.exactTurnIds = [firstTurn.turnId];
      const nextId = await launch(slide, nextTurn.message, nextTurn);
      const nextInput = (await inspect(nextId)).run.initialInput;
      assert.match(nextInput, /Human selected: Evidence first/);
      assert.match(nextInput, /Selected option ID: evidence-first/);
      assert.match(nextInput, /Selected option description: Lead with measured evidence\./);
      assert.ok(nextInput.includes('Selected option value (Workflow content): ' + selectedNarrative));
      assert.ok(nextInput.includes('Human guidance: ' + chosen.guidance));
      assert.match(nextInput, /Other offered options omitted from conversation context/);
      assert.match(nextInput, /Draft 1[\s\S]*Draft 2/);
      assert.doesNotMatch(nextInput, /UNSELECTED-ROUTE|Story first|Unselected customer framing/);
      const { rows: [{ context_json: frozen }] } = await pool.query('SELECT context_json FROM conversation_turns WHERE run_id=$1', [nextId]);
      assert.deepEqual(frozen.exactTurnIds, [firstTurn.turnId]);
      await cancel(nextId);
    }

    const review = await loadWorkflow('editorial-review');
    review.nodes[0].config.message = 'This explanation was displayed beside the question.';
    const editorialTurn = makeTurn(review, 'Prepare an internal note.');
    const editorialId = await launch(review, editorialTurn.message, editorialTurn);
    const ask = await request(editorialId, 'input');
    assert.equal(ask.request.sourceContext, undefined);
    await assert.rejects(reply(editorialId, ask.id, { kind: 'input', text: '   ' }), { code: 'interaction_response_invalid' });
    await reply(editorialId, ask.id, { kind: 'input', text: 'Steering committee.\n' });
    const edit = await request(editorialId, 'edit');
    assert.equal(edit.request.original, originalDraft);
    assert.deepEqual(JSON.parse(inputs.findLast(item => item.instructions === 'drafter').input),
      { humanResponse: 'Steering committee.\n', incomingContext: 'Prepare an internal note.' });
    await reply(editorialId, edit.id, { kind: 'edit', text: confirmed });
    const approval = await request(editorialId, 'approval');
    assert.equal(approval.request.reviewed, confirmed);
    await assert.rejects(reply(editorialId, approval.id, { kind: 'approval', outcome: 'revise' }), { code: 'interaction_response_invalid' });
    await reply(editorialId, approval.id, { kind: 'approval', outcome: 'revise', feedback: 'Add the date.' });
    const secondEdit = await request(editorialId, 'edit', edit.id);
    assert.notEqual(secondEdit.activationId, edit.activationId);
    assert.deepEqual(JSON.parse(inputs.findLast(item => item.instructions === 'drafter').input),
      { reviewedContent: confirmed, humanFeedback: 'Add the date.' });
    await reply(editorialId, secondEdit.id, { kind: 'edit', text: secondEdit.request.original });
    const secondApproval = await request(editorialId, 'approval', approval.id);
    await assert.rejects(reply(editorialId, approval.id, { kind: 'approval', outcome: 'approve' }), { code: 'interaction_response_conflict' });
    await reply(editorialId, secondApproval.id, { kind: 'approval', outcome: 'approve' });
    const editorialDone = await wait(editorialId, detail => detail.run.status === 'succeeded');
    assert.equal(editorialDone.run.finalOutput, originalDraft);
    const terminal = editorialDone.content.items.at(-1);
    assert.equal(terminal.section.terminal, true);
    assert.equal((await command('runs.display', { runId: editorialId, scope: context, activationId: terminal.section.id })).markdown, originalDraft);
    assert.equal(editorialDone.content.items.filter(item => item.kind === 'interaction').length, 5);
    assert.deepEqual((await outputs(editorialId)).map(item => item.id), [terminal.section.id]);
    const editorialFollowup = makeTurn(review, 'What did we revise?', await thread(editorialTurn.conversationId));
    editorialFollowup.exactTurnIds = [editorialTurn.turnId];
    const editorialFollowupId = await launch(review, editorialFollowup.message, editorialFollowup);
    const editorialHistory = (await inspect(editorialFollowupId)).run.initialInput;
    assert.match(editorialHistory, /Workflow explanation: This explanation was displayed beside the question\./);
    assert.match(editorialHistory, /Hidden input context omitted from conversation context/);
    assert.ok(editorialHistory.includes('Exact text confirmed by human: ' + confirmed));
    assert.match(editorialHistory, /Steering committee[\s\S]*Edited draft[\s\S]*Human feedback: Add the date\.[\s\S]*Human outcome: Approved/);
    await cancel(editorialFollowupId);

    const rejected = await launch(review, 'Draft to reject.');
    await assert.rejects(reply(rejected, ask.id, { kind: 'input', text: 'Wrong Run' }), { code: 'interaction_not_found' });
    await reply(rejected, (await request(rejected, 'input')).id, { kind: 'input', text: 'The editorial board.' });
    await reply(rejected, (await request(rejected, 'edit')).id, { kind: 'edit', text: confirmed });
    await reply(rejected, (await request(rejected, 'approval')).id, { kind: 'approval', outcome: 'reject', feedback: 'Withdraw the draft.' });
    const rejectedRun = await wait(rejected, detail => detail.run.status === 'rejected');
    assert.equal(rejectedRun.run.failureCode, undefined);
    assert.ok(rejectedRun.content.items.every(item => item.kind === 'interaction'));

    const branch = {
      ...review, id: 'static-decision',
      nodes: [{ id: 'select', blockType: 'human-decision', blockVersion: 1, config: {
        source: 'static', routing: 'branches', message: 'Which branch?', options: [{ id: 'left', title: 'Left' }, { id: 'right', title: 'Right' }],
      } }, ...['left', 'right'].map(id => ({ id, blockType: 'agent', blockVersion: 4, config: { agentId: id } })), review.nodes.at(-1)],
      edges: ['left', 'right'].flatMap(id => [
        { id: 'choose-' + id, source: 'select', sourcePort: id, target: id },
        { id: id + '-final', source: id, target: 'final' },
      ]),
    };
    const branchTurn = makeTurn(branch, 'Pick one.');
    const branchId = await launch(branch, branchTurn.message, branchTurn);
    const staticRequest = await request(branchId, 'decision');
    await reply(branchId, staticRequest.id, { kind: 'decision', optionId: 'right' });
    assert.equal((await wait(branchId, detail => detail.run.status === 'succeeded')).run.finalOutput, 'Right branch output');
    assert.ok(!inputs.some(item => item.instructions === 'left'));
    assert.equal(JSON.parse(inputs.findLast(item => item.instructions === 'right').input).selectedValue, 'Right');
    const branchFollowup = makeTurn(branch, 'Why this route?', await thread(branchTurn.conversationId));
    branchFollowup.exactTurnIds = [branchTurn.turnId];
    const branchFollowupId = await launch(branch, branchFollowup.message, branchFollowup);
    assert.match((await inspect(branchFollowupId)).run.initialInput, /Selected option value \(Workflow content\): Right/);
    await cancel(branchFollowupId);

    const oversized = structuredClone(branch);
    oversized.id = 'oversized-decision';
    oversized.nodes[0].config.options[1].value = `Oversized option begins here. ${'x'.repeat(15_400)}`;
    const oversizedTurn = makeTurn(oversized, 'Choose the detailed route.');
    const oversizedId = await launch(oversized, oversizedTurn.message, oversizedTurn);
    await reply(oversizedId, (await request(oversizedId, 'decision')).id, { kind: 'decision', optionId: 'right' });
    await wait(oversizedId, detail => detail.run.status === 'succeeded');
    const oversizedFollowup = makeTurn(oversized, 'Recall the exact route.', await thread(oversizedTurn.conversationId));
    await assert.rejects(launch(oversized, oversizedFollowup.message, { ...oversizedFollowup, exactTurnIds: [oversizedTurn.turnId] }),
      { code: 'conversation_context_too_large' });
    const boundedId = await launch(oversized, oversizedFollowup.message, oversizedFollowup);
    const { rows: [{ context_json: bounded }] } = await pool.query('SELECT context_json FROM conversation_turns WHERE run_id=$1', [boundedId]);
    assert.deepEqual(bounded.exactTurnIds, []);
    assert.ok(bounded.omittedHistory > 0 || bounded.summary.detailsOmitted);
    assert.ok(Buffer.byteLength((await inspect(boundedId)).run.initialInput) <= 9000 + Buffer.byteLength(oversizedFollowup.message));
    await cancel(boundedId);

    const raceId = await launch(review, 'Cancel while waiting.');
    const race = await request(raceId, 'input');
    await application.stop();
    const outcomes = await Promise.allSettled([reply(raceId, race.id, { kind: 'input', text: 'An answer' }), command('runs.cancel', { runId: raceId })]);
    assert.equal(outcomes[1].status, 'fulfilled');
    if (outcomes[0].status === 'rejected') assert.equal(outcomes[0].reason.code, 'interaction_not_pending');
    await assert.rejects(reply(raceId, race.id, { kind: 'input', text: 'Too late' }), { code: 'interaction_not_pending' });
    const staleId = await launch(review, 'A stale request.');
    application = createRuntimeApplication(options);
    application.start();
    await wait(raceId, detail => detail.run.status === 'cancelled');
    assert.equal((await inspect(raceId)).attempts.length, 0);
    const stale = await request(staleId, 'input');
    await application.stop();
    await pool.query('UPDATE workflow_runs SET workflow_generation=2 WHERE id=$1', [staleId]);
    await assert.rejects(reply(staleId, stale.id, { kind: 'input', text: 'Stale reply' }), { code: 'interaction_not_pending' });
    await command('runs.cancel', { runId: staleId });
    malformed = true;
    application = createRuntimeApplication(options);
    application.start();
    const invalidId = await launch(slide, 'Generate invalid options.');
    const invalid = await wait(invalidId, detail => detail.run.status === 'failed');
    assert.match(invalid.run.failureMessage, /Human Decision expected valid option JSON/);
    assert.ok(!invalid.content?.items.length);
    assert.equal((await activity(invalidId)).entries[0].state, 'failed');

    const display = id => ({ id, blockType: 'display-output', blockVersion: 1, config: { label: id } });
    const earlyDisplay = display('before-failure');
    const failsAfterDisplay = { ...review, id: 'historical-display',
      nodes: [earlyDisplay, slide.nodes.find(node => node.id === 'choose'), display('end')],
      edges: [{ id: 'show-first', source: earlyDisplay.id, target: 'choose' }, { id: 'unreachable', source: 'choose', target: 'end' }],
    };
    const historicalId = await launch(failsAfterDisplay, 'Keep this visible after the failure.  \r\n');
    const historical = await wait(historicalId, detail => detail.run.status === 'failed');
    assert.deepEqual(historical.content.items.map(item => item.section?.markdown), ['Keep this visible after the failure.  \r\n']);

    const displayChain = Array.from({ length: 16 }, (_, index) => display('show-' + index));
    const long = { ...review, id: 'paged-display', nodes: displayChain,
      edges: displayChain.slice(1).map((node, index) => ({ id: 'next-' + index, source: displayChain[index].id, target: node.id })) };
    const longId = await launch(long, 'A paginated output.');
    const longRun = await wait(longId, detail => detail.run.status === 'succeeded');
    const firstPage = longRun.content;
    const earlierPage = await command('runs.content', { runId: longId, scope: context, before: firstPage.before });
    assert.equal(new Set([...earlierPage.items, ...firstPage.items].map(item => item.section.id)).size, 16);
    assert.equal(firstPage.items.filter(item => item.section.terminal).length, 1);
    const activities = await activity(longId);
    const olderActivities = await activity(longId, activities.before);
    assert.equal(activities.completed, 16);
    assert.equal(new Set([...activities.entries, ...olderActivities.entries].map(entry => entry.id)).size, 16);

    const gate = id => ({ ...review.nodes[0], id, config: { questionSource: 'configured', question: `Continue at ${id}?` } });
    const nodes = [
      ...Array.from({ length: 14 }, (_, index) => display(`first-${index}`)), gate('first-gate'),
      ...Array.from({ length: 15 }, (_, index) => display(`second-${index}`)), gate('second-gate'), display('final-output'),
    ];
    const timeline = { ...review, id: 'live-timeline', nodes,
      edges: nodes.slice(1).map((node, index) => ({ id: `advance-${index}`, source: nodes[index].id, target: node.id })),
      limits: { maxStepExecutions: nodes.length },
    };
    const liveId = await launch(timeline, 'First page content.  \r\n');
    const firstGate = await request(liveId, 'input');
    const initialContent = await content(liveId), initialActivity = await activity(liveId);
    assert.ok(initialContent.before && initialActivity.before);
    const archivedContent = await content(liveId, initialContent.before);
    const archivedActivity = await activity(liveId, initialActivity.before);
    assert.equal(archivedContent.before, null);
    assert.equal(archivedActivity.before, null);
    assert.equal(initialActivity.entries.find(entry => entry.nodeId === 'first-gate').state, 'waiting');
    await reply(liveId, firstGate.id, { kind: 'input', text: 'Second page content.  \r\n' });
    const secondGate = await request(liveId, 'input', firstGate.id);
    const latestContent = await content(liveId), latestActivity = await activity(liveId);
    assert.ok(!latestContent.items.some(item => item.id === firstGate.id));
    assert.ok(!latestActivity.entries.some(entry => entry.nodeId === 'first-gate'));
    const asContent = page => ({ ...page, entries: page.items });
    const contentKey = item => ({ sequence: item.sequence, id: item.kind === 'display' ? item.section.id : item.id });
    const reconciledContent = await reconcileEvidenceWindow(asContent(latestContent), archivedContent.before,
      async before => asContent(await content(liveId, before)), contentKey, compareContentPosition);
    const reconciledActivity = await reconcileEvidenceWindow(latestActivity, archivedActivity.before,
      before => activity(liveId, before), entry => entry, compareActivityPosition);
    assert.equal(new Set(reconciledContent.entries.map(item => contentKey(item).id)).size, 31);
    assert.equal(new Set(reconciledActivity.entries.map(entry => entry.id)).size, 31);
    assert.equal(reconciledActivity.entries.find(entry => entry.nodeId === 'first-gate').state, 'completed');
    assert.equal(reconciledActivity.entries.find(entry => entry.nodeId === 'second-gate').state, 'waiting');
    const liveOutputs = await outputs(liveId);
    assert.equal(liveOutputs.length, 29);
    assert.deepEqual(liveOutputs.map(item => item.id), reconciledContent.entries.filter(item => item.kind === 'display')
      .sort((left, right) => left.sequence - right.sequence).map(item => item.section.id));
    assert.ok(liveOutputs.every(item => item.contentSource === 'display' && item.markdown === undefined));
    await assert.rejects(command('runs.outputs', { runId: liveId, scope: { ...context, branch: 'other' } }), { code: 'run_not_found' });
    await reply(liveId, secondGate.id, { kind: 'input', text: 'Exact final output.  \r\n' });
    await wait(liveId, detail => detail.run.status === 'succeeded');
    const finalOutputs = await outputs(liveId);
    assert.equal(finalOutputs.length, 30);
    assert.deepEqual(finalOutputs.slice(0, -1), liveOutputs);
    const finalOutput = await command('runs.display', { runId: liveId, scope: context, activationId: finalOutputs.at(-1).id });
    assert.equal(finalOutput.markdown, 'Exact final output.  \r\n');
    assert.deepEqual(stages, []);
  } finally {
    releaseChallenger?.();
    await application?.stop();
    await runtime?.close();
    await pool.end();
    await rm(directory, { recursive: true });
  }
});
