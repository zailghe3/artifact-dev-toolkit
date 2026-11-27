import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { initializeRuntimeDatabase, runtimePostgresPool } from '../../adt-runtime/dist/postgres.js';
import { createRuntimeServer } from '../../adt-runtime/dist/server.js';
import { createRuntimeApplication } from '../../adt-runtime/dist/workflow-application.js';
import { recordManagementNonce } from '../../adt-runtime/dist/operational-settings.js';
import { InMemoryWorkflowDefinitionRepository } from '../../lib/workflow-definition-repository.ts';
import { runtimeControl } from '../../lib/runtime-service-client.ts';
import { publishClaimedKnowledge } from '../../lib/advisor-knowledge-proposals.ts';
import { deterministicConnection } from '../../lib/workflow-connections.ts';
import { agent, connection, context as fixtureContext, run as legacyRun, workflow } from '../support/advisor-fixtures.mjs';
import { DEFAULT_ARTIFACT_ROOT } from '../../lib/artifact-contract.ts';
import { knowledgeFixture } from '../support/knowledge-fixture.mjs';
import { installTsxHook } from '../render-tsx.mjs';

const connectionString = process.env.ADT_TEST_POSTGRES_URL;
const context = { ...fixtureContext, root: DEFAULT_ARTIFACT_ROOT };

test('PostgreSQL conversation admission, context, approvals, actions and retry survive Runtime replacement', {
  skip: !connectionString && 'Set ADT_TEST_POSTGRES_URL with a disposable adt_conversations database',
  timeout: 100_000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'adt-conversations-'));
  const url = new URL(connectionString);
  url.pathname = '/adt_conversations';
  const pool = runtimePostgresPool({ connectionString: url.href });
  let application, runtime, modelCalls = 0;
  const providerInputs = [];
  const summaryCalls = [];
  const answer = '# Findings\n\n```ts\nconst result = 42;  \n```\n\n' + 'Evidence from the original question. '.repeat(17);
  const finalAnswer = '## Reviewed result\n\nThe final Agent used the reviewed evidence.';
  try {
    const oldMigrations = join(directory, 'old-migrations');
    const migrationSource = new URL('../../adt-runtime/migrations/', import.meta.url);
    await mkdir(oldMigrations);
    for (const file of (await readdir(migrationSource)).filter(name => /^000[1-5]_/.test(name))) {
      await copyFile(new URL(file, migrationSource), join(oldMigrations, file));
    }
    const keyPath = join(directory, 'root.json');
    await initializeRuntimeDatabase(pool, keyPath, pathToFileURL(oldMigrations + '/'));
    const historical = legacyRun({ advisorContext: { version: 1, readOnly: true, override: null } });
    await pool.query(`INSERT INTO workflow_runs (id,engine_version,workflow_id,workflow_revision,workflow_snapshot_json,
      agent_snapshots_json,agent_revisions_json,connection_snapshots_json,initial_input,status,created_at,updated_at,
      repository_context_json,execution_plan_json,semantic_workflow_snapshot_json,advisor_context_json,final_output)
      VALUES ($1,'2',$2,$3,'{}',$4,$5,$6,$7,'succeeded',now(),now(),$8,$9,$10,$11,'Historic Advisor answer')`,
    [historical.id, historical.workflowId, historical.workflowRevision, historical.agentSnapshots, historical.agentRevisions,
      historical.connectionSnapshots, historical.initialInput, historical.repositoryContext, historical.executionPlan,
      historical.semanticWorkflowSnapshot, historical.advisorContext]);
    const installation = await initializeRuntimeDatabase(pool, keyPath);
    assert.equal((await pool.query('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1')).rows[0].name, '0006_conversations.sql');

    const authSecret = 'conversation-postgres-authentication-fixture'.repeat(2);
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' } });
    const env = { ADT_RUNTIME_AUTH_SECRET: authSecret, ADT_RUNTIME_WRAPPING_PUBLIC_KEY: keys.publicKey,
      ADT_CONVERSATION_HISTORY_BYTES: '1850', ADT_CONVERSATION_RECENT_TURNS: '1', WORKFLOW_ENABLE_DETERMINISTIC_TEST_CONNECTION: 'true' };
    const fakeCredential = 'fixture-conversation-provider-token';
    const stages = [];
    const provider = async (_url, init) => {
      assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${fakeCredential}`);
      const body = JSON.parse(init.body);
      const instructions = body.messages.find(message => message.role === 'system' || message.role === 'developer').content;
      const input = body.messages.findLast(message => message.role === 'user').content;
      let content;
      if (instructions.startsWith('Summarise earlier chat exchanges')) {
        assert.deepEqual(body.tools ?? [], []);
        assert.ok(body.max_completion_tokens <= 750);
        assert.doesNotMatch(input, /fixture-conversation-provider-token|SENSITIVE_PROMPT/);
        summaryCalls.push(input);
        content = 'Earlier exchanges recorded findings about the original question.';
      } else {
        providerInputs.push({ instructions, input });
        content = instructions === 'Use the first Agent output.' ? finalAnswer : answer;
      }
      return Response.json({ id: `fixture-${++modelCalls}`, object: 'chat.completion', created: 1, model: 'gpt-5',
        usage: { prompt_tokens: 14, completion_tokens: 5 },
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] });
    };
    const options = { pool, ...installation, env, providerFetcher: provider, onError: stage => stages.push(stage) };
    application = createRuntimeApplication(options);
    runtime = await createRuntimeServer({ host: '127.0.0.1', port: 0, authSecret, privateKeyPem: keys.privateKey,
      revision: 'conversation-postgres', control: command => application.store(command),
      recordManagementNonce: (nonce, timestamp) => recordManagementNonce(pool, nonce, timestamp),
      providerHttp: { fetcher: provider }, logger() {} });
    await runtime.listen();
    env.ADT_RUNTIME_BASE_URL = `http://127.0.0.1:${runtime.server.address().port}`;
    const config = { baseUrl: env.ADT_RUNTIME_BASE_URL, authSecret };
    const command = (operation, fields = {}, repositoryId = context.repositoryId) => runtimeControl(config, { operation, repositoryId, ...fields });
    const secret = await command('vault', { method: 'create', arguments: [fakeCredential] });
    const savedConnection = { ...connection, credentialSecretRef: secret };
    const deterministic = deterministicConnection(env);
    const repo = new InMemoryWorkflowDefinitionRepository();
    const first = { ...agent, tools: [], executionPolicy: 'read-only', masterPrompt: 'Investigate the user question.',
      prompt: { source: 'custom', text: 'Investigate the user question.' } };
    const last = { ...first, id: 'reviewer', name: 'Reviewer', masterPrompt: 'Use the first Agent output.',
      prompt: { source: 'custom', text: 'Use the first Agent output.' } };
    const passing = { ...first, id: 'pass', name: 'Pass', executionPolicy: undefined, connectionKey: deterministic.key,
      tools: [], adapterOptions: {} };
    const fail = { ...passing, id: 'fail', name: 'Fail', adapterOptions: { mode: 'terminal_failure' } };
    for (const definition of [first, last, passing, fail]) await repo.createAgent(definition);
    const knowledge = { id: 'knowledge', blockType: 'knowledge-proposal', blockVersion: 1, config: { label: 'Evidence worth saving' } };
    const multi = await repo.createWorkflow({ ...workflow, id: 'review-flow', nodes: [
      workflow.nodes[0], knowledge, { id: 'approve', blockType: 'approval', blockVersion: 1, config: { message: 'Review the evidence' } },
      { id: 'finish', blockType: 'agent', blockVersion: 1, config: { agentId: last.id } },
    ], edges: [
      { id: 'offer-knowledge', source: 'analyse', target: 'knowledge' },
      { id: 'review-knowledge', source: 'knowledge', target: 'approve' },
      { id: 'finish-review', source: 'approve', target: 'finish' },
    ], limits: { maxStepExecutions: 4 } });
    await repo.createWorkflow({ ...workflow, id: 'advisor', nodes: [workflow.nodes[0], knowledge],
      edges: [{ id: 'offer-knowledge', source: 'analyse', target: 'knowledge' }] });
    await repo.createWorkflow({ ...workflow, id: 'retry-flow', nodes: [
      { id: 'first', blockType: 'agent', blockVersion: 1, config: { agentId: passing.id } },
      { id: 'last', blockType: 'agent', blockVersion: 1, config: { agentId: fail.id } },
    ], edges: [{ id: 'advance', source: 'first', target: 'last' }] });
    const { launchConversationTurn } = installTsxHook()('../lib/workflow-run-admission.ts');
    const access = { ...context, repo: context.repository, login: 'reviewer', githubId: 27, checkedAt: Date.now(), ok: true };
    const deps = {
      workflowRuntimeCommand: input => runtimeControl(config, input),
      getWorkflowRunStorage: async () => ({ createConversationRun: (snapshot, conversation) => command('runs.launch', { snapshot, conversation }) }),
      createWorkflowDefinitionRepository: () => repo,
      listWorkflowConnectionIdentityDescriptors: async () => [savedConnection, deterministic],
      listWorkflowConnectionDescriptors: async () => [savedConnection, deterministic],
      readCodexRunnerCatalog: async () => ({ environments: [] }),
      getProviderCredentialVault: async () => ({}), getMcpPolicyAuthority: async () => ({}),
      createToolDefinitionRepository: () => ({ list: async () => [] }),
      createSecurityProfileDefinitionRepository: () => ({ list: async () => [] }),
      getWorkflowProviderConnectionStore: async () => ({ resolveForSnapshot: async (_key, descriptor) => descriptor }),
    };
    const submit = input => launchConversationTurn(access, input, deps);
    const detail = id => command('conversations.detail', { scope: context, id });
    const inspect = runId => command('runs.detail', { runId });
    const make = (target, message, current) => ({
      conversationId: current?.conversation.id ?? crypto.randomUUID(), turnId: crypto.randomUUID(), message, target,
      after: current?.head ?? null, exactTurnIds: [],
    });
    const wait = async (id, status) => {
      let conversation;
      for (let index = 0; index < 125; index++) {
        conversation = await detail(id);
        const observed = conversation?.turns.at(-1);
        if (observed?.status === status) return conversation;
        if (observed?.status === 'failed' && status !== 'failed') break;
        await new Promise(resolve => setTimeout(resolve, 110));
      }
      assert.fail(JSON.stringify({ status, stages, conversation }));
    };

    const singleTarget = { kind: 'agent', id: first.id };
    const firstSubmission = make(singleTarget, 'Initial evidence question.  \n');
    const duplicates = await Promise.all([submit(firstSubmission), submit(firstSubmission)]);
    assert.equal(duplicates[0].runId, duplicates[1].runId);
    assert.equal(duplicates.filter(result => !result.replay).length, 1);
    assert.equal((await detail(firstSubmission.conversationId)).turns.length, 1);
    await assert.rejects(submit({ ...firstSubmission, message: 'different' }), { code: 'workflow_idempotency_conflict' });
    await assert.rejects(submit(make(singleTarget, 'overlap', await detail(firstSubmission.conversationId))), { code: 'conversation_turn_active' });
    application.start();

    let single = await wait(firstSubmission.conversationId, 'succeeded');
    assert.equal(single.turns[0].sections[0].markdown, answer);
    assert.equal(single.turns[0].sections[0].actions, undefined);
    const singleView = await inspect(duplicates[0].runId);
    assert.equal(singleView.attempts.length, 1);
    assert.equal(singleView.conversation.message, firstSubmission.message);
    assert.equal(singleView.attempts[0].conversationSource, undefined);
    const followUp = make(singleTarget, 'Can you compare the finding with the new result?', single);
    const followRun = await submit(followUp);
    single = await wait(single.conversation.id, 'succeeded');
    const frozenFollowUp = await inspect(followRun.runId);
    assert.ok(frozenFollowUp.run.initialInput.includes(firstSubmission.message));
    assert.ok(frozenFollowUp.run.initialInput.includes(answer));
    assert.ok(frozenFollowUp.run.initialInput.endsWith(followUp.message));
    assert.equal(frozenFollowUp.attempts[0].inputText, frozenFollowUp.run.initialInput);
    assert.equal(frozenFollowUp.attempts[0].conversationSource, undefined);

    const more = make(singleTarget, 'Which decision did we make?', single);
    await submit(more);
    single = await wait(single.conversation.id, 'succeeded');
    const lastTurn = make(singleTarget, 'Summarize our conclusion now.', single);
    const summariesBeforeRace = summaryCalls.length;
    const lastTurnRace = await Promise.allSettled([submit(lastTurn), submit(lastTurn)]);
    const admitted = lastTurnRace.find(result => result.status === 'fulfilled')?.value;
    assert.ok(admitted, JSON.stringify(lastTurnRace));
    for (const result of lastTurnRace) {
      if (result.status === 'rejected') assert.equal(result.reason.code, 'conversation_summary_pending');
      else assert.equal(result.value.runId, admitted.runId);
    }
    assert.equal(summaryCalls.length, summariesBeforeRace + 1);
    single = await wait(single.conversation.id, 'succeeded');
    assert.equal(single.turns.length, 4);
    assert.equal(single.turns.at(-1).summaryUsed, true);
    assert.ok(summaryCalls.length > 0);
    const savedContext = (await pool.query('SELECT context_json FROM conversation_turns WHERE run_id=$1', [admitted.runId])).rows[0].context_json;
    assert.equal(savedContext.summary.method, 'provider');
    assert.equal(savedContext.summary.source.model, 'gpt-5');
    assert.ok((await inspect(admitted.runId)).run.initialInput.includes(savedContext.summary.text));
    const beforeReplay = summaryCalls.length;
    assert.equal((await submit(lastTurn)).runId, admitted.runId);
    assert.equal(summaryCalls.length, beforeReplay);

    const multiTarget = { kind: 'workflow', id: multi.definition.id };
    const submission = make(multiTarget, 'Review the available evidence.');
    const launched = await submit(submission);
    let thread = await wait(submission.conversationId, 'waiting_approval');
    assert.equal(thread.approval.message, 'Review the evidence');
    assert.equal(thread.approval.reviewText, answer);
    await application.stop();
    application = createRuntimeApplication(options);
    assert.deepEqual((await detail(thread.conversation.id)).approval, thread.approval);
    await command('runs.approval', { runId: launched.runId, approvalRequestId: thread.approval.requestId });
    application.start();
    thread = await wait(thread.conversation.id, 'succeeded');
    assert.deepEqual(providerInputs.findLast(entry => entry.instructions === last.masterPrompt).input, answer);
    const multiRun = await inspect(launched.runId);
    assert.equal(multiRun.attempts.length, 2);
    const sections = thread.turns[0].sections;
    assert.equal(sections[0].markdown, finalAnswer);
    assert.equal(sections[0].actions, undefined);
    assert.equal(sections[1].label, knowledge.config.label);
    const actionId = sections[1].actions[0].id;
    const lookup = { scope: context, runId: launched.runId, actionId };
    assert.deepEqual(await command('runs.action', lookup), { markdown: answer });
    await assert.rejects(command('runs.action', { ...lookup, actionId: 'a'.repeat(64) }), { code: 'workflow_action_not_found' });
    await assert.rejects(command('runs.action', { ...lookup, scope: { ...context, branch: 'unrelated' } }), { code: 'workflow_action_not_found' });
    assert.equal(await command('conversations.detail', { scope: { ...context, repositoryId: 99 }, id: thread.conversation.id }, 99), null);

    const actor = { githubId: access.githubId, login: 'reviewer', sessionId: 'f'.repeat(64) };
    const knowledgeCommand = (method, ...args) => command('knowledge', { scope: context, actor, method, arguments: args });
    const proposals = await Promise.all([command('knowledge.from-action', { ...lookup, actor }), command('knowledge.from-action', { ...lookup, actor })]);
    const draft = proposals[0];
    assert.equal(draft.id, proposals[1].id);
    assert.equal(draft.state, 'draft');
    assert.deepEqual(draft.document.metadata.runIds, [launched.runId]);
    assert.ok(draft.document.metadata.evidence[0].source.includes(':block:analyse:'));
    assert.ok(draft.document.body.includes('const result = 42;'));
    const revised = await knowledgeCommand('save', { id: draft.id, revision: draft.revision, expectedSha: null,
      document: { ...draft.document, body: 'Reviewed excerpt confirmed by the user.' } });
    const git = knowledgeFixture();
    const { reviewToken } = await knowledgeCommand('review', revised.id, revised.revision);
    const publishing = { claimPublication: (...args) => knowledgeCommand('claim', ...args),
      finishPublication: (...args) => knowledgeCommand('finish', ...args) };
    const publish = () => publishClaimedKnowledge(publishing, revised.id, revised.revision, reviewToken,
      (document, expected, login) => git.repository.publish(document, expected, login));
    assert.equal(git.writes.length, 0);
    assert.equal((await publish()).state, 'published');
    await assert.rejects(publish(), /knowledge_review_required/);
    assert.equal(git.writes.length, 1);

    const nextWorkflow = await repo.updateWorkflow({ ...multi.definition, name: 'Review flow v2' }, multi.fileSha);
    const next = await submit(make(multiTarget, 'Revisit the review.', thread));
    thread = await wait(thread.conversation.id, 'waiting_approval');
    assert.equal(thread.turns.at(-1).definitionChanged, true);
    assert.equal((await inspect(next.runId)).run.workflowRevision, nextWorkflow.fileSha);
    assert.equal((await inspect(launched.runId)).run.workflowRevision, multi.fileSha);
    await command('runs.cancel', { runId: next.runId });
    thread = await wait(thread.conversation.id, 'cancelled');
    assert.equal((await detail(thread.conversation.id)).turns[0].sections[1].actions[0].id, actionId);
    const continued = await submit(make(multiTarget, 'Continue after the cancelled review.', thread));
    assert.doesNotMatch((await inspect(continued.runId)).run.initialInput, /Revisit the review/);
    await command('runs.cancel', { runId: continued.runId });
    await wait(thread.conversation.id, 'cancelled');
    await command('conversations.rename', { scope: context, id: thread.conversation.id, title: 'Renamed review' });
    assert.equal((await command('conversations.list', { scope: context, query: 'Renamed review' })).items[0].id, thread.conversation.id);

    const advisorTarget = { kind: 'workflow', id: 'advisor' };
    const advisor = await submit(make(advisorTarget, 'Verify Advisor uses the same engine.'));
    const advisorThread = await wait(advisor.conversationId, 'succeeded');
    assert.equal(advisorThread.turns[0].sections.length, 1);
    assert.equal(advisorThread.turns[0].sections[0].actions.length, 1);
    assert.equal((await inspect(advisor.runId)).run.executionPolicy, 'read-only');
    assert.deepEqual((await command('conversations.list', { scope: context, query: '', target: advisorTarget })).items.map(item => item.id),
      [advisor.conversationId]);
    const historic = await inspect(historical.id);
    assert.equal(historic.run.advisorContext.readOnly, true);
    assert.equal(historic.run.finalOutput, 'Historic Advisor answer');
    assert.equal(historic.conversation, undefined);

    const retryTarget = { kind: 'workflow', id: 'retry-flow' };
    const failed = await submit(make(retryTarget, 'Start a run that can fail.'));
    let retryThread = await wait(failed.conversationId, 'failed');
    const staleHead = retryThread.head;
    assert.equal(retryThread.retryEligible, true);
    await command('runs.retry', { runId: failed.runId });
    retryThread = await wait(failed.conversationId, 'failed');
    assert.equal(retryThread.head.generation, 2);
    const retried = await inspect(failed.runId);
    assert.equal(retried.attempts.filter(attempt => attempt.stepId === 'first').length, 1);
    assert.equal(retried.attempts.filter(attempt => attempt.stepId === 'last').length, 2);
    await assert.rejects(submit({ ...make(retryTarget, 'stale submission', retryThread), after: staleHead }), { code: 'conversation_head_changed' });
    const definition = await repo.getAgent(fail.id);
    await repo.updateAgent({ ...definition.definition, adapterOptions: {} }, definition.fileSha);
    const freshTurn = make(retryTarget, 'Start the next message after failure.', retryThread);
    const nextAfterFailure = await submit(freshTurn);
    retryThread = await wait(failed.conversationId, 'succeeded');
    assert.equal(retryThread.turns.length, 2);
    assert.equal((await inspect(nextAfterFailure.runId)).run.initialInput, freshTurn.message);
    await assert.rejects(command('runs.retry', { runId: failed.runId }), { code: 'conversation_retry_superseded' });

    await application.stop();
    const differentSubmissions = ['First concurrent message', 'Second concurrent message'].map(message => make(retryTarget, message, retryThread));
    const competing = await Promise.allSettled(differentSubmissions.map(submit));
    assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
    assert.ok(['conversation_turn_active', 'conversation_head_changed'].includes(competing.find(result => result.status === 'rejected').reason.code));
    assert.equal((await detail(retryThread.conversation.id)).turns.length, 3);
    assert.deepEqual(stages, []);
  } finally {
    await application?.stop();
    await runtime?.close();
    await pool.end();
    await rm(directory, { recursive: true });
  }
});
