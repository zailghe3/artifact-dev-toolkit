import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import {readFile} from 'node:fs/promises';
import {installTsxHook} from './render-tsx.mjs';

const requireTsx=installTsxHook();
const {InMemoryWorkflowDefinitionRepository}=requireTsx('../lib/workflow-definition-repository.ts');
const {persistedAgentDefinitionSchema,workflowDefinitionSchema}=requireTsx('../lib/workflow-definitions.ts');
const access={repositoryId:1,installationId:1,owner:'owner',repo:'repo',installationCredentialProvider:async()=>({token:'never-used'})};
const agent=persistedAgentDefinitionSchema.parse({schemaVersion:2,id:'managed',name:'Managed',description:'',status:'draft',prompt:{source:'custom',text:'Do work.'},connectionKey:'codex-primary',adapterOptions:{environmentKey:'managed-env',managedGit:true}});
const oneAgent=id=>workflowDefinitionSchema.parse({schemaVersion:2,id,name:id,description:'',status:'draft',nodes:[{id:'agent-node',blockType:'agent',blockVersion:1,config:{agentId:'managed'}}],edges:[],limits:{maxStepExecutions:2}});
const withPublish=base=>workflowDefinitionSchema.parse({...base,nodes:[...base.nodes,{id:'publish',blockType:'publish-github-pr',blockVersion:1,config:{sourceNodeId:'agent-node',title:'Ship',body:'',draft:true}}],edges:[{id:'publish-edge',source:'agent-node',sourcePort:'out',target:'publish',targetPort:'managed-result'}]});

async function withAuthoringRoutes(run){
 const repository=new InMemoryWorkflowDefinitionRepository();await repository.createAgent(agent);let runnerCalls=0;
 const services={createWorkflowDefinitionRepository:()=>repository,listWorkflowConnectionIdentityDescriptors:async()=>[{key:'codex-primary',adapter:'codex-runner',enabled:false}],readCodexRunnerCatalog:async()=>{runnerCalls++;throw new Error('Runner RPC must not occur during Workflow authoring')}};
 const original=Module._load;Module._load=function(request,parent,isMain){if(request==='@/lib/auth')return{requireApiRepositoryAccess:async()=>({access})};if(request==='@/lib/workflow-services')return services;return original.call(this,request,parent,isMain)};
 try{const createPath=requireTsx.resolve('../app/api/workflow-definitions/route.ts'),updatePath=requireTsx.resolve('../app/api/workflow-definitions/[id]/route.ts');delete requireTsx.cache[createPath];delete requireTsx.cache[updatePath];await run({repository,create:requireTsx(createPath).POST,update:requireTsx(updatePath).PUT,getRunnerCalls:()=>runnerCalls})}finally{Module._load=original}
}

test('Workflow PUT persists Agent to Publish without any live Runner discovery',async()=>withAuthoringRoutes(async({repository,update,getRunnerCalls})=>{const original=await repository.createWorkflow(oneAgent('existing')),definition=withPublish(original.definition),response=await update(new Request('https://adt.example/api/workflow-definitions/existing',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({definition,fileSha:original.fileSha})}),{params:Promise.resolve({id:'existing'})});assert.equal(response.status,200);assert.equal(getRunnerCalls(),0);const persisted=await repository.getWorkflow('existing');assert.equal(persisted.definition.nodes.length,2);assert.deepEqual(persisted.definition.edges,definition.edges)}));

test('Workflow POST creates Agent to Publish without any live Runner discovery',async()=>withAuthoringRoutes(async({repository,create,getRunnerCalls})=>{const definition=withPublish(oneAgent('created')),response=await create(new Request('https://adt.example/api/workflow-definitions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(definition)}));assert.equal(response.status,201);assert.equal(getRunnerCalls(),0);assert.deepEqual((await repository.getWorkflow('created')).definition,definition)}));

test('Workflow authoring routes and pages statically exclude live Runner discovery',async()=>{for(const path of ['../app/api/workflow-definitions/route.ts','../app/api/workflow-definitions/[id]/route.ts','../app/workflows/definitions/new/page.tsx','../app/workflows/definitions/[workflowId]/edit/page.tsx']){const source=await readFile(new URL(path,import.meta.url),'utf8');assert.doesNotMatch(source,/readCodexRunnerCatalog|listWorkflowConnectionDescriptors/);assert.match(source,/listWorkflowConnectionIdentityDescriptors/)}});
