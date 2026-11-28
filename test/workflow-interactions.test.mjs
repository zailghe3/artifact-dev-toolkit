import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { dynamicDecisionOptionsSchema, interactionResponseSchema, validateInteractionResponse } from '../adt-runtime/src/workflow-interaction-contract.ts';
import { assertInteractivePlanTopology, compileWorkflowV2ExecutionPlan, composeWorkflowV2, workflowDefinitionV2Schema } from '../lib/workflow-definitions.ts';
import { hydrateWorkflowEditor, workflowDefinitionFromEditor } from '../lib/workflow-editor-state.ts';
import { parseWorkflowTransfer } from '../lib/workflow-transfer.ts';

const first = { id: 'first', title: 'First proposal', value: 'First' };
const second = { id: 'second', title: 'Second proposal', value: 'Second' };

test('dynamic decisions strictly validate IDs, contents and payload bounds', () => {
  assert.ok(dynamicDecisionOptionsSchema.safeParse({ options: [first, second] }).success);
  const invalid = [
    [], { options: [] }, { options: [first] }, { options: [first, first] },
    { options: [first, { ...second, id: 'Second?' }] },
    { options: [first, { ...second, value: '' }] },
    { options: [first, { ...second, authority: 'allow' }] },
    { options: [first, { ...second, title: '🎉'.repeat(161) }] },
    { options: Array.from({ length: 8 }, (_, i) => ({ id: 'option-' + i, title: 'Option', value: 'x'.repeat(16_000) })) },
  ];
  for (const payload of invalid) assert.equal(dynamicDecisionOptionsSchema.safeParse(payload).success, false);
});

test('responses preserve exact text, separate decisions from routing and cannot grant authority', () => {
  const text = '  Edited text\r\n\twith spacing. \r\n';
  assert.deepEqual(validateInteractionResponse({ kind: 'edit', version: 1, question: 'Edit', original: 'Before' },
    { kind: 'edit', text }), { output: text, route: undefined });
  const request = { kind: 'decision', version: 1, question: 'Choose', options: [first, second], allowGuidance: true, routing: 'branches' };
  const selected = validateInteractionResponse(request, { kind: 'decision', optionId: 'first', guidance: 'Route to second' });
  assert.equal(selected.route, 'first');
  assert.deepEqual(JSON.parse(selected.output), { selectedTitle: first.title, selectedValue: first.value, humanGuidance: 'Route to second' });
  assert.equal(interactionResponseSchema.safeParse({ kind: 'decision', optionId: 'first', tool: { authorized: true } }).success, false);
  assert.throws(() => validateInteractionResponse(request, { kind: 'approval', outcome: 'approve' }), /interaction_response_invalid/);
  const input = { kind: 'input', version: 1, question: 'Optional?', required: false, showContext: false, includeContext: false, sourceContext: '' };
  assert.equal(validateInteractionResponse(input, { kind: 'input', text: '' }).output, '');
});

test('editor and clipboard preserve a human revision loop in the composed frozen plan', async () => {
  const editable = JSON.parse(await readFile(new URL('../test-fixtures/interactive-workflows/editorial-review.workflow.json', import.meta.url), 'utf8'));
  const workflow = workflowDefinitionV2Schema.parse(editable);
  const imported = parseWorkflowTransfer(JSON.stringify({ format: 'adt-workflow-transfer', version: 1, definition: workflow }));
  assert.ok(imported.ok);
  const agents = [{ id: 'drafter', name: 'Drafter' }];
  const state = hydrateWorkflowEditor(imported.transfer.definition, undefined, agents, []);
  const draft = workflowDefinitionFromEditor(state.fields, state.nodes, state.edges);
  assert.deepEqual(draft.nodes.filter(node => node.blockType !== 'agent'), workflow.nodes.filter(node => node.blockType !== 'agent'));
  assert.equal(draft.edges.find(edge => edge.id === 'revise').sourcePort, 'revise');
  const compiled = compileWorkflowV2ExecutionPlan(draft, agents);
  assert.doesNotThrow(() => assertInteractivePlanTopology(compiled));
  assert.throws(() => assertInteractivePlanTopology({ ...compiled, edges: compiled.edges.filter(edge => edge.sourcePort !== 'revise') }), /unsupported_workflow_topology/);
  const child = { ...draft, exposableAsBlock: true };
  const root = { ...draft, id: 'wrapper', nodes: [{ id: 'sub', blockType: 'subworkflow', blockVersion: 1, config: { workflowId: child.id } }], edges: [] };
  const expanded = composeWorkflowV2(root, new Map([[child.id, child]]));
  assert.equal(expanded.nodes.length, child.nodes.length);
  assert.ok(expanded.edges.some(edge => edge.sourcePort === 'revise'));
});
