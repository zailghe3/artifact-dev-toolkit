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
 const files=new Map(),mutations=[];
 const request=async(path,init)=>{
  if((path==='/contents/_adt/agents'||path==='/contents/_adt/workflows'||path==='/contents/agents'||path==='/contents/workflows')&&!init){const root=path.slice('/contents/'.length);return Response.json([...files].filter(([name])=>name.startsWith(`${root}/`)).map(([name])=>({name:name.split('/').at(-1),path:name})));}
  const name=path.replace('/contents/','');
  if(!init){const file=files.get(name);return file?Response.json(file):new Response(null,{status:404});}
  mutations.push({name,method:init.method,body:JSON.parse(init.body)});
  if(init.method==='DELETE'){const body=JSON.parse(init.body),file=files.get(name);if(!file)return new Response(null,{status:404});if(file.sha!==body.sha)return new Response(null,{status:409});files.delete(name);return Response.json({});}
  const body=JSON.parse(init.body),existing=files.get(name);if((existing&&body.sha!==existing.sha)||(!existing&&body.sha))return new Response(null,{status:409});const file={content:body.content,sha:`sha-${mutations.length}`};files.set(name,file);return Response.json({content:{sha:file.sha}});
 };
 return {files,mutations,repository:new GitHubWorkflowDefinitionRepository(request)};
}
const stored=value=>({content:Buffer.from(JSON.stringify(value)).toString('base64'),sha:`sha-${value.id}`});

test('Git-backed Agent definitions round-trip connection keys independently of adapter names',async()=>{
 const {files,repository}=gitFixture();
 for(const agent of agents){
  const created=await repository.createAgent(agent);
  assert.deepEqual(created.definition,normalized(agent));
  const file=files.get(`agents/${agent.id}.agent.json`);
  const persisted=Buffer.from(file.content,'base64').toString('utf8');
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
 await assert.rejects(repository.deleteAgent(agents[1].id,'stale-sha'),/changed/);assert.ok(files.has('agents/deterministic-agent.agent.json'));
 await repository.deleteAgent(agents[1].id,agent.fileSha);assert.equal(await repository.getAgent(agents[1].id),undefined);assert.ok(files.has('workflows/review-flow.workflow.json'));
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

test('Git-backed definitions read both layouts, preserve exact paths, and keep collisions fail-closed',async()=>{
 const {files,mutations,repository}=gitFixture();
 const created=await repository.createAgent(agents[0]);
 assert.equal(created.sourcePath,'agents/openai-agent.agent.json');
 files.set('_adt/agents/openai-agent.agent.json',{...files.get('agents/openai-agent.agent.json'),sha:'legacy-sha'});
 files.delete('agents/openai-agent.agent.json');
 const legacy=await repository.getAgent('openai-agent');
 assert.equal(legacy.sourcePath,'_adt/agents/openai-agent.agent.json');
 const updated=await repository.updateAgent({...legacy.definition,name:'Updated'},legacy.fileSha);
 assert.equal(updated.sourcePath,'_adt/agents/openai-agent.agent.json');
 assert.deepEqual(mutations.at(-1),{name:'_adt/agents/openai-agent.agent.json',method:'PUT',body:{message:'Update _adt/agents/openai-agent.agent.json',content:mutations.at(-1).body.content,sha:'legacy-sha'}});
 files.set('agents/openai-agent.agent.json',{...files.get('_adt/agents/openai-agent.agent.json'),sha:'future-sha'});
 await assert.rejects(repository.listAgents(),/duplicated across _adt\/agents\/openai-agent\.agent\.json and agents\/openai-agent\.agent\.json/);
 const count=mutations.length;await assert.rejects(repository.deleteAgent('openai-agent',updated.fileSha),/duplicated/);assert.equal(mutations.length,count);
});

test('Workflow IDs also fail closed across legacy and future definition roots',async()=>{
 const {files,repository}=gitFixture();
 await repository.createWorkflow(workflow);
 files.set('_adt/workflows/review-flow.workflow.json',{...files.get('workflows/review-flow.workflow.json'),sha:'legacy-sha'});
 await assert.rejects(repository.listWorkflows(),/Definition ID "review-flow" is duplicated/);
});

test('creation checks both layouts and writes only canonical root paths',async()=>{
 const {files,mutations,repository}=gitFixture();files.set('_adt/agents/openai-agent.agent.json',stored(agents[0]));files.set('_adt/workflows/review-flow.workflow.json',stored(workflow));
 await assert.rejects(repository.createAgent(agents[0]),/changed/);await assert.rejects(repository.createWorkflow(workflow),/changed/);assert.equal(mutations.length,0);
 const agent=await repository.createAgent(agents[1]),second={...workflow,id:'second-flow',name:'Second flow',steps:[{...workflow.steps[0],agentId:'deterministic-agent'}]},createdWorkflow=await repository.createWorkflow(second);
 assert.equal(agent.sourcePath,'agents/deterministic-agent.agent.json');assert.equal(createdWorkflow.sourcePath,'workflows/second-flow.workflow.json');
 assert.deepEqual(mutations.map(item=>item.name),['agents/deterministic-agent.agent.json','workflows/second-flow.workflow.json']);
});

test('mixed layouts list normally and update and delete each exact observed path and SHA',async()=>{
 const {files,mutations,repository}=gitFixture();
 files.set('_adt/agents/openai-agent.agent.json',stored(agents[0]));files.set('agents/deterministic-agent.agent.json',stored(agents[1]));
 files.set('_adt/workflows/review-flow.workflow.json',stored(workflow));
 const second={...workflow,id:'second-flow',name:'Second flow',steps:[{...workflow.steps[0],agentId:'deterministic-agent'}]};files.set('workflows/second-flow.workflow.json',stored(second));
 assert.deepEqual((await repository.listAgents()).map(x=>x.sourcePath),['_adt/agents/openai-agent.agent.json','agents/deterministic-agent.agent.json']);
 assert.deepEqual((await repository.listWorkflows()).map(x=>x.sourcePath),['_adt/workflows/review-flow.workflow.json','workflows/second-flow.workflow.json']);
 for(const id of ['openai-agent','deterministic-agent']){const value=await repository.getAgent(id);await repository.updateAgent({...value.definition,description:'changed'},value.fileSha);assert.equal(mutations.at(-1).name,value.sourcePath);assert.equal(mutations.at(-1).body.sha,value.fileSha);}
 for(const id of ['review-flow','second-flow']){const value=await repository.getWorkflow(id);await repository.updateWorkflow({...value.definition,description:'changed'},value.fileSha);assert.equal(mutations.at(-1).name,value.sourcePath);assert.equal(mutations.at(-1).body.sha,value.fileSha);const revised=await repository.getWorkflow(id);await repository.deleteWorkflow(id,revised.fileSha);assert.equal(mutations.at(-1).name,value.sourcePath);assert.equal(mutations.at(-1).body.sha,revised.fileSha);}
 for(const id of ['openai-agent','deterministic-agent']){const value=await repository.getAgent(id);await repository.deleteAgent(id,value.fileSha);assert.equal(mutations.at(-1).name,value.sourcePath);assert.equal(mutations.at(-1).body.sha,value.fileSha);}
});

test('stale revisions prevent PUT and DELETE in either layout',async()=>{
 const {files,mutations,repository}=gitFixture();files.set('_adt/agents/openai-agent.agent.json',stored(agents[0]));files.set('agents/deterministic-agent.agent.json',stored(agents[1]));
 for(const id of ['openai-agent','deterministic-agent']){const value=await repository.getAgent(id),count=mutations.length;await assert.rejects(repository.updateAgent(value.definition,'stale'),/changed/);await assert.rejects(repository.deleteAgent(id,'stale'),/changed/);assert.equal(mutations.length,count);}
});

test('Agent-in-use checks logical references across mixed layouts',async()=>{
 const {files,repository}=gitFixture();files.set('_adt/agents/openai-agent.agent.json',stored(agents[0]));files.set('workflows/review-flow.workflow.json',stored(workflow));const value=await repository.getAgent('openai-agent');await assert.rejects(repository.deleteAgent('openai-agent',value.fileSha),/agent_in_use/);
});

const reusableChild={schemaVersion:2,id:'reusable-child',name:'Reusable child',description:'A',status:'draft',exposableAsBlock:true,nodes:[{id:'work',blockType:'agent',blockVersion:1,config:{agentId:'openai-agent'}}],edges:[],limits:{maxStepExecutions:4}};
const reusableParent={schemaVersion:2,id:'reusable-parent',name:'Reusable parent',description:'',status:'draft',nodes:[{id:'child-call',blockType:'subworkflow',blockVersion:1,config:{workflowId:'reusable-child'}},{id:'finish',blockType:'agent',blockVersion:1,config:{agentId:'openai-agent'}}],edges:[{id:'edge',source:'child-call',target:'finish'}],limits:{maxStepExecutions:8}};

test('referenced reusable Workflows reject deletion and unexposure while content edits remain allowed',async()=>{for(const make of [()=>new InMemoryWorkflowDefinitionRepository(),()=>gitFixture().repository]){const repository=make(),child=await repository.createWorkflow(reusableChild);await repository.createWorkflow(reusableParent);await assert.rejects(repository.deleteWorkflow(reusableChild.id,child.fileSha),/workflow_in_use/);await assert.rejects(repository.updateWorkflow({...reusableChild,exposableAsBlock:false},child.fileSha),/workflow_in_use/);const edited=await repository.updateWorkflow({...reusableChild,description:'B'},child.fileSha);assert.equal(edited.definition.description,'B');assert.notEqual(edited.fileSha,child.fileSha);const unrelated=await repository.createWorkflow({...reusableChild,id:'unrelated-child',name:'Unrelated'});await repository.deleteWorkflow('unrelated-child',unrelated.fileSha);assert.equal(await repository.getWorkflow('unrelated-child'),undefined)}});

const agentNode=id=>({id,blockType:'agent',blockVersion:1,config:{agentId:'openai-agent'}});
const sequential=(id,nodes,exposableAsBlock=true)=>({schemaVersion:2,id,name:id,description:'',status:'draft',...(exposableAsBlock?{exposableAsBlock:true}:{}),nodes,edges:nodes.slice(1).map((node,index)=>({id:`${id}-edge-${index}`,source:nodes[index].id,target:node.id})),limits:{maxStepExecutions:128}});
const structuredParent={schemaVersion:2,id:'structured-parent',name:'Structured parent',description:'',status:'draft',nodes:[agentNode('source'),{id:'child-branch',blockType:'subworkflow',blockVersion:1,config:{workflowId:'reusable-child'}},agentNode('sibling'),{id:'join',blockType:'join',blockVersion:1,config:{}},agentNode('finish')],edges:[{id:'to-child',source:'source',target:'child-branch'},{id:'to-sibling',source:'source',target:'sibling'},{id:'child-join',source:'child-branch',target:'join'},{id:'sibling-join',source:'sibling',target:'join'},{id:'join-finish',source:'join',target:'finish'}],limits:{maxStepExecutions:16}};

test('referenced Workflow edits that break a direct composed dependent fail before mutation',async()=>{for(const make of [()=>new InMemoryWorkflowDefinitionRepository(),()=>gitFixture().repository]){const repository=make(),child=await repository.createWorkflow(reusableChild);await repository.createWorkflow(structuredParent);const incompatible=sequential('reusable-child',[agentNode('work-a'),agentNode('work-b')]);await assert.rejects(repository.updateWorkflow(incompatible,child.fileSha),/workflow_dependency_incompatible/);assert.equal((await repository.getWorkflow('reusable-child')).fileSha,child.fileSha);assert.equal((await repository.getWorkflow('reusable-child')).definition.nodes.length,1)}});

test('referenced Workflow edits validate the complete reverse transitive dependent closure',async()=>{for(const make of [()=>new InMemoryWorkflowDefinitionRepository(),()=>gitFixture().repository]){const repository=make(),child=await repository.createWorkflow(reusableChild),parentNodes=[{id:'child-call',blockType:'subworkflow',blockVersion:1,config:{workflowId:'reusable-child'}},...Array.from({length:15},(_,index)=>agentNode(`parent-${index}`))],parent=sequential('transitive-parent',parentNodes),grandparent=sequential('transitive-grandparent',[{id:'parent-call',blockType:'subworkflow',blockVersion:1,config:{workflowId:'transitive-parent'}},agentNode('grand-a'),agentNode('grand-b')],false);await repository.createWorkflow(parent);await repository.createWorkflow(grandparent);const expandedChild=sequential('reusable-child',Array.from({length:16},(_,index)=>agentNode(`child-${index}`)));await assert.rejects(repository.updateWorkflow(expandedChild,child.fileSha),/workflow_dependency_incompatible/);assert.equal((await repository.getWorkflow('reusable-child')).definition.description,'A');const unrelated=await repository.createWorkflow({...reusableChild,id:'unrelated-exposed',name:'Unrelated'});const updated=await repository.updateWorkflow({...unrelated.definition,description:'unrelated edit'},unrelated.fileSha);assert.equal(updated.definition.description,'unrelated edit')}});
