import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWorkflowV2ExecutionPlan,composeVersionedWorkflowV2,workflowDefinitionSchema} from '../lib/workflow-definitions.ts';
const agent=id=>({schemaVersion:2,id,name:id,description:'',status:'draft',connectionKey:'ready',prompt:{source:'custom',text:'prompt'},masterPrompt:'prompt'});
const context=(overrides={})=>({publishOutput:false,includeRunInput:false,includeNodeOutputs:[],...overrides});
const node=(id,agentId,version=1,configuration)=>({id,blockType:'agent',blockVersion:version,config:{agentId,...(configuration===undefined?{}:{context:configuration})}});
const workflow=(nodes,edges=nodes.slice(1).map((value,index)=>({id:`e-${index}`,source:nodes[index].id,target:value.id})))=>({schemaVersion:2,id:'context',name:'Context',description:'',status:'draft',nodes,edges,limits:{maxStepExecutions:8}});

test('execution-plan compatibility normalizes only inactive authored agent@2 blocks',()=>{
 const cases=[
  [node('legacy','a'),1],
  [node('inactive','a',2,context()),1],
  [node('omitted','a',2),1],
  [node('publish','a',2,context({publishOutput:true})),2],
  [node('run-input','a',2,context({includeRunInput:true})),2],
 ];
 for(const [authored,expectedVersion] of cases){const definition=workflow([authored]),plan=compileWorkflowV2ExecutionPlan(definition,[agent('a')]);assert.equal(definition.nodes[0].blockVersion,authored.blockVersion);assert.equal(plan.nodes[0].blockVersion,expectedVersion)}
 const selected=workflow([node('producer','a',2,context({publishOutput:true})),node('consumer','b',2,context({includeNodeOutputs:['producer']}))]);assert.equal(compileWorkflowV2ExecutionPlan(selected,[agent('a'),agent('b')]).nodes[1].blockVersion,2);
});

test('context references fail closed for self, missing, non-publishing, and structurally-later sources',()=>{const valid=workflow([node('producer','a',2,context({publishOutput:true})),node('consumer','b',2,context({includeNodeOutputs:['producer']}))]);assert.doesNotThrow(()=>workflowDefinitionSchema.parse(valid));for(const source of ['consumer','missing'])assert.throws(()=>workflowDefinitionSchema.parse({...valid,nodes:valid.nodes.map(value=>value.id==='consumer'?node('consumer','b',2,context({includeNodeOutputs:[source]})):value)}));assert.throws(()=>workflowDefinitionSchema.parse({...valid,nodes:[node('producer','a',2,context()),valid.nodes[1]]}));assert.throws(()=>workflowDefinitionSchema.parse({...valid,nodes:[node('producer','a',2,context({publishOutput:true,includeNodeOutputs:['consumer']})),valid.nodes[1]]}))});

test('context references do not create topology and child references remap to scoped execution IDs',()=>{const child=workflowDefinitionSchema.parse({...workflow([node('producer','a',2,context({publishOutput:true})),node('consumer','b',2,context({includeNodeOutputs:['producer']}))]),id:'child-context',name:'Child',exposableAsBlock:true}),parent=workflowDefinitionSchema.parse({schemaVersion:2,id:'parent-context',name:'Parent',description:'',status:'draft',nodes:[{id:'child-call',blockType:'subworkflow',blockVersion:1,config:{workflowId:'child-context'}}],edges:[],limits:{maxStepExecutions:4}}),composed=composeVersionedWorkflowV2({definition:parent,fileSha:'parent'},[{definition:child,fileSha:'child'}]),producer=composed.composition.nodes.find(value=>value.semanticNodeId==='producer').executionNodeId,consumer=composed.workflow.nodes.find(value=>value.id!==producer);assert.equal(composed.workflow.edges.length,1);assert.deepEqual(consumer.config.context.includeNodeOutputs,[producer])});
