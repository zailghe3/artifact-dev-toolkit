import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateAgentAdapterOptions} from '../lib/workflow-definitions.ts';

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
 assert.match(editor,/c\.adapter!=="codex-runner"/);assert.match(editor,/\(Configuration available\)/);assert.match(editor,/codexBlockers\.length>0/);
 for(const source of [create,edit,route,editor])assert.doesNotMatch(source,/encrypted_credential|credential_iv|Authorization/);
});

test('Agent creation resolves OpenAI connection adapters before persistence and rejects malformed options',async()=>{
 const route=await readFile(new URL('../app/api/workflow-agents/route.ts',import.meta.url),'utf8');
 assert.match(route,/listWorkflowConnectionDescriptors\(\)/);
 assert.match(route,/validateAgentForConnection\(base,connection\)/);
 assert.match(route,/createAgent\(definition\)/);
 const agent={schemaVersion:1,id:'openai-agent',name:'OpenAI agent',description:'',status:'draft',masterPrompt:'Respond carefully.',connectionKey:'openai-primary',adapterOptions:{reasoningEffort:'medium',verbosity:'medium'}};
 assert.deepEqual(validateAgentAdapterOptions(agent,'openai-responses'),agent);
 assert.throws(()=>validateAgentAdapterOptions({...agent,adapterOptions:{reasoningEffort:'invalid'}},'openai-responses'));
});

test('Agent POST and PUT preserve granular fail-closed Codex validation for disabled descriptors',async()=>{
 const routes=await Promise.all([readFile(new URL('../app/api/workflow-agents/route.ts',import.meta.url),'utf8'),readFile(new URL('../app/api/workflow-agents/[id]/route.ts',import.meta.url),'utf8')]);
 for(const route of routes){
  assert.match(route,/!connection\|\|\(!connection\.enabled&&connection\.adapter!=="codex-runner"\)/);
  assert.match(route,/connection\.adapter==="codex-runner"\)await validateCodexRunnerAgentOptions/);
  assert.ok(route.indexOf('validateAgentForConnection')<route.indexOf('validateCodexRunnerAgentOptions(definition.adapterOptions)'));
 }
});
