import test from 'node:test';
import assert from 'node:assert/strict';
import {GitHubWorkflowDefinitionRepository,InMemoryWorkflowDefinitionRepository} from '../lib/workflow-definition-repository.ts';

const agents=[
 {schemaVersion:1,id:'openai-agent',name:'OpenAI agent',description:'',status:'draft',masterPrompt:'Respond carefully.',connectionKey:'openai-primary',adapterOptions:{reasoningEffort:'medium',verbosity:'medium'}},
 {schemaVersion:1,id:'deterministic-agent',name:'Deterministic agent',description:'',status:'draft',masterPrompt:'Respond predictably.',connectionKey:'deterministic-test'},
 {schemaVersion:1,id:'codex-agent',name:'Codex agent',description:'',status:'draft',masterPrompt:'Work in the environment.',connectionKey:'codex-cloud-primary',adapterOptions:{environmentKey:'adt-development'}},
];
const normalized=agent=>({schemaVersion:2,id:agent.id,name:agent.name,description:agent.description,status:agent.status,connectionKey:agent.connectionKey,...(agent.adapterOptions?{adapterOptions:agent.adapterOptions}:{}),prompt:{source:'custom',text:agent.masterPrompt},masterPrompt:agent.masterPrompt});

function gitFixture(){
 const files=new Map();
 const request=async(path,init)=>{
  if((path==='/contents/_adt/agents'||path==='/contents/_adt/workflows'||path==='/contents/agents'||path==='/contents/workflows')&&!init){const root=path.slice('/contents/'.length);return Response.json([...files].filter(([name])=>name.startsWith(`${root}/`)).map(([name])=>({name:name.split('/').at(-1),path:name})));}
  const name=path.replace('/contents/','');
  if(!init){const file=files.get(name);return file?Response.json(file):new Response(null,{status:404});}
  if(init.method==='DELETE'){const body=JSON.parse(init.body),file=files.get(name);if(!file)return new Response(null,{status:404});if(file.sha!==body.sha)return new Response(null,{status:409});files.delete(name);return Response.json({});}
  const body=JSON.parse(init.body),file={content:body.content,sha:`sha-${files.size+1}`};files.set(name,file);return Response.json({content:{sha:file.sha}});
 };
 return {files,repository:new GitHubWorkflowDefinitionRepository(request)};
}

test('Git-backed Agent definitions round-trip connection keys independently of adapter names',async()=>{
 const {files,repository}=gitFixture();
 for(const agent of agents){
  const created=await repository.createAgent(agent);
  assert.deepEqual(created.definition,normalized(agent));
  const stored=files.get(`_adt/agents/${agent.id}.agent.json`);
  const persisted=Buffer.from(stored.content,'base64').toString('utf8');
  assert.match(persisted,/"prompt"/);assert.doesNotMatch(persisted,/masterPrompt/);
  assert.deepEqual((await repository.getAgent(agent.id)).definition,normalized(agent));
 }
 const listed=await repository.listAgents();
 assert.deepEqual(listed.map(item=>item.definition),agents.map(normalized));
});

test('in-memory Agent definitions apply the same structural-only persistence rule',async()=>{
 const repository=new InMemoryWorkflowDefinitionRepository();
 for(const agent of agents)assert.deepEqual((await repository.createAgent(agent)).definition,normalized(agent));
 assert.deepEqual((await repository.listAgents()).map(item=>item.definition),agents.map(normalized));
});

const workflow={schemaVersion:1,id:'review-flow',name:'Review flow',description:'',status:'draft',steps:[{id:'step-1',name:'Review',agentId:'openai-agent',input:{source:'run_input'},onSuccess:{type:'complete'},onFailure:{type:'fail'}}],result:{source:'step_output',stepId:'step-1'},limits:{maxStepExecutions:1}};

test('Git-backed definitions delete only the exact file at the expected revision',async()=>{
 const {files,repository}=gitFixture(),agent=await repository.createAgent(agents[1]),createdWorkflow=await repository.createWorkflow(workflow);
 await assert.rejects(repository.deleteAgent(agents[1].id,'stale-sha'),/changed/);assert.ok(files.has('_adt/agents/deterministic-agent.agent.json'));
 await repository.deleteAgent(agents[1].id,agent.fileSha);assert.equal(await repository.getAgent(agents[1].id),undefined);assert.ok(files.has('_adt/workflows/review-flow.workflow.json'));
 await assert.rejects(repository.deleteWorkflow(workflow.id,'stale-sha'),/changed/);await repository.deleteWorkflow(workflow.id,createdWorkflow.fileSha);assert.equal(await repository.getWorkflow(workflow.id),undefined);
});

test('in-memory definitions enforce optimistic revisions when deleting',async()=>{
 const repository=new InMemoryWorkflowDefinitionRepository(),agent=await repository.createAgent(agents[1]),createdWorkflow=await repository.createWorkflow(workflow);
 await assert.rejects(repository.deleteAgent(agents[1].id,'stale-sha'),/changed/);assert.ok(await repository.getAgent(agents[1].id));
 await repository.deleteAgent(agents[1].id,agent.fileSha);assert.equal(await repository.getAgent(agents[1].id),undefined);assert.ok(await repository.getWorkflow(workflow.id));
 await assert.rejects(repository.deleteWorkflow(workflow.id,'stale-sha'),/changed/);await repository.deleteWorkflow(workflow.id,createdWorkflow.fileSha);assert.equal(await repository.getWorkflow(workflow.id),undefined);
});

test('referenced Agents cannot be deleted and definitions remain unchanged',async()=>{
 for(const make of [()=>new InMemoryWorkflowDefinitionRepository(),()=>gitFixture().repository]){
  const repository=make(),agent=await repository.createAgent(agents[0]),createdWorkflow=await repository.createWorkflow(workflow);
  await assert.rejects(repository.deleteAgent(agents[0].id,agent.fileSha),/agent_in_use/);
  assert.deepEqual((await repository.getAgent(agents[0].id)).definition,normalized(agents[0]));
  assert.deepEqual(await repository.getWorkflow(workflow.id),createdWorkflow);
 }
});

test('Git-backed definitions read future roots, preserve paths, reject collisions and keep writes legacy',async()=>{
 const {files,repository}=gitFixture();
 const created=await repository.createAgent(agents[0]);
 assert.equal(created.sourcePath,'_adt/agents/openai-agent.agent.json');
 files.set('agents/openai-agent.agent.json',{...files.get('_adt/agents/openai-agent.agent.json'),sha:'future-sha'});
 files.delete('_adt/agents/openai-agent.agent.json');
 const future=await repository.getAgent('openai-agent');
 assert.equal(future.sourcePath,'agents/openai-agent.agent.json');
 assert.equal(future.fileSha,'future-sha');
 await assert.rejects(repository.updateAgent(future.definition,future.fileSha),/read-only/);
 files.set('_adt/agents/openai-agent.agent.json',{...files.get('agents/openai-agent.agent.json'),sha:'legacy-sha'});
 await assert.rejects(repository.listAgents(),/duplicated across _adt\/agents\/openai-agent\.agent\.json and agents\/openai-agent\.agent\.json/);
});

test('Workflow IDs also fail closed across legacy and future definition roots',async()=>{
 const {files,repository}=gitFixture();
 await repository.createWorkflow(workflow);
 files.set('workflows/review-flow.workflow.json',{...files.get('_adt/workflows/review-flow.workflow.json'),sha:'future-sha'});
 await assert.rejects(repository.listWorkflows(),/Definition ID "review-flow" is duplicated/);
});
