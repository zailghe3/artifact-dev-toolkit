import {readFile,readdir} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {agentDefinitionSchema,workflowDefinitionSchema,compileWorkflowV2ExecutionPlan} from '../../lib/workflow-definitions.ts';
import {newLangGraphWorkflowRun} from '../../lib/workflow-storage.ts';
import {ADT_DATA_TOOLS} from '../../lib/adt-data-contract.ts';
export const context={repositoryId:42,installationId:7,owner:'acme',repository:'private',branch:'main',root:'artifacts'};
export const connection={key:'agents',name:'Agents',adapter:'openai-agents',defaultModel:'gpt-5',enabled:true,management:'git',credentialSource:'adt-vault',credentialSecretRef:`sec_${'a'.repeat(43)}`,repositoryRevision:'connection-sha',capabilities:{asynchronous:false,cancellation:false,agentTools:true,runtimeSecurity:true}};
export const agent=agentDefinitionSchema.parse({schemaVersion:2,id:'analyst',name:'Analyst',description:'',status:'draft',connectionKey:'agents',prompt:{source:'custom',text:'SENSITIVE_PROMPT'},tools:[...ADT_DATA_TOOLS]});
export const workflow=workflowDefinitionSchema.parse({schemaVersion:2,id:'review',name:'Review',description:'',status:'draft',runInputTemplate:'SENSITIVE_STARTER',nodes:[{id:'analyse',blockType:'agent',blockVersion:1,config:{agentId:agent.id}}],edges:[],limits:{maxStepExecutions:4}});
export function run(extra={}){return newLangGraphWorkflowRun({id:crypto.randomUUID(),workflow,revision:'workflow-sha',executionPlan:compileWorkflowV2ExecutionPlan(workflow,[agent]),agents:[agent],connections:[connection],initialInput:'SENSITIVE_INPUT',repositoryContext:context,...extra})}
export async function database(t){
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:{DB:crypto.randomUUID()}}));t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');
 for(const name of (await readdir('test-fixtures/legacy-operational-migrations')).filter(name=>name.endsWith('.sql')).sort()){
  const sql=await readFile(`test-fixtures/legacy-operational-migrations/${name}`,'utf8');await db.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
 }
 return db;
}
