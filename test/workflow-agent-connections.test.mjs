import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Agent pages and connection API use the shared safe workflow catalogue',async()=>{
 const [create,edit,route,editor]=await Promise.all([
  readFile(new URL('../app/workflows/agents/new/page.tsx',import.meta.url),'utf8'),
  readFile(new URL('../app/workflows/agents/[agentId]/edit/page.tsx',import.meta.url),'utf8'),
  readFile(new URL('../app/api/workflow-connections/route.ts',import.meta.url),'utf8'),
  readFile(new URL('../components/WorkflowAgentEditor.tsx',import.meta.url),'utf8')
 ]);
 for(const source of [create,edit,route])assert.match(source,/listWorkflowConnectionDescriptors/);
 assert.doesNotMatch(create,/listConnectionDescriptors/);assert.doesNotMatch(edit,/listConnectionDescriptors/);
 assert.match(edit,/if\(!value\)notFound\(\)/);assert.match(edit,/connections\.find\(c=>c\.key===value\.definition\.connectionKey\)/);
 assert.match(editor,/disabled=\{!c\.enabled&&c\.key!==initial\?\.connectionKey\}/);assert.match(editor,/\(Not configured\)/);assert.match(editor,/disabled=\{!selected\?\.enabled\}/);
 for(const source of [create,edit,route,editor])assert.doesNotMatch(source,/encrypted_credential|credential_iv|Authorization/);
});
