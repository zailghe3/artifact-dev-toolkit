import test from 'node:test';
import assert from 'node:assert/strict';
import {GitHubWorkflowDefinitionRepository,InMemoryWorkflowDefinitionRepository} from '../lib/workflow-definition-repository.ts';
import {canonicalJson} from '../lib/workflow-definitions.ts';

const agents=[
 {schemaVersion:1,id:'openai-agent',name:'OpenAI agent',description:'',status:'draft',masterPrompt:'Respond carefully.',connectionKey:'openai-primary',adapterOptions:{reasoningEffort:'medium',verbosity:'medium'}},
 {schemaVersion:1,id:'deterministic-agent',name:'Deterministic agent',description:'',status:'draft',masterPrompt:'Respond predictably.',connectionKey:'deterministic-test'},
 {schemaVersion:1,id:'codex-agent',name:'Codex agent',description:'',status:'draft',masterPrompt:'Work in the environment.',connectionKey:'codex-cloud-primary',adapterOptions:{environmentKey:'adt-development'}},
];

function gitFixture(){
 const files=new Map();
 const request=async(path,init)=>{
  if(path==='/contents/_adt/agents'&&!init){return Response.json([...files].map(([name])=>({name:name.split('/').at(-1),path:name})));}
  const name=path.replace('/contents/','');
  if(!init){const file=files.get(name);return file?Response.json(file):new Response(null,{status:404});}
  const body=JSON.parse(init.body),file={content:body.content,sha:`sha-${files.size+1}`};files.set(name,file);return Response.json({content:{sha:file.sha}});
 };
 return {files,repository:new GitHubWorkflowDefinitionRepository(request)};
}

test('Git-backed Agent definitions round-trip connection keys independently of adapter names',async()=>{
 const {files,repository}=gitFixture();
 for(const agent of agents){
  const created=await repository.createAgent(agent);
  assert.deepEqual(created.definition,agent);
  const stored=files.get(`_adt/agents/${agent.id}.agent.json`);
  assert.equal(Buffer.from(stored.content,'base64').toString('utf8'),canonicalJson(agent));
  assert.deepEqual((await repository.getAgent(agent.id)).definition,agent);
 }
 const listed=await repository.listAgents();
 assert.deepEqual(listed.map(item=>item.definition),agents);
});

test('in-memory Agent definitions apply the same structural-only persistence rule',async()=>{
 const repository=new InMemoryWorkflowDefinitionRepository();
 for(const agent of agents)assert.deepEqual((await repository.createAgent(agent)).definition,agent);
 assert.deepEqual((await repository.listAgents()).map(item=>item.definition),agents);
});
