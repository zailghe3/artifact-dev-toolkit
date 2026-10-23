import test from 'node:test';
import assert from 'node:assert/strict';
import {parseWorkflowTransfer,workflowTransferSchema,WORKFLOW_TRANSFER_MAX_BYTES} from '../lib/workflow-transfer.ts';
import {createWorkflowAuthoringContext,serializeWorkflowAuthoringContext,reusableWorkflowAuthoringCandidates,workflowAuthoringContextSchema} from '../lib/workflow-authoring-context.ts';
import {hydrateWorkflowEditor,workflowDefinitionFromEditor} from '../lib/workflow-editor-state.ts';
import {workflowAuthoringPreflight} from '../lib/workflow-authoring-preflight.ts';
import {workflowBlockRegistry} from '../lib/workflow-block-registry.ts';
import {workflowDefinitionV2Schema,canonicalJson,MAX_WORKFLOW_STEPS,WORKFLOW_RUN_INPUT_MAX_LENGTH} from '../lib/workflow-definitions.ts';
import {normalizeWorkflowLayout} from '../lib/workflow-layout.ts';
import {isAgentPublishAuthoringEligible} from '../lib/workflow-publish-eligibility.ts';

const agentNode=(id,agentId='actual-agent',version=1,extra={})=>({id,blockType:'agent',blockVersion:version,config:{agentId,...extra}});
const workflow=(nodes=[agentNode('start')],edges=nodes.slice(1).map((node,index)=>({id:`edge-${index}`,source:nodes[index].id,target:node.id})))=>({schemaVersion:2,id:'imported',name:'Imported',description:'A description',status:'draft',runInputTemplate:'Task:\n',exposableAsBlock:true,nodes,edges,limits:{maxStepExecutions:128}});
const envelope=definition=>({format:'adt-workflow-transfer',version:1,definition});
const parse=value=>parseWorkflowTransfer(JSON.stringify(value));
const agents=[{id:'actual-agent',name:'Actual Agent',description:'Safe description',adapter:'codex-runner',connectionKey:'private-connection',environmentKey:'private-environment',managedGit:true,publishEligible:true}];
const reusable=[{id:'actual-reusable',name:'Reusable',description:'Safe reusable description'}];
const layout=definition=>normalizeWorkflowLayout(definition,Object.fromEntries(definition.nodes.map((node,i)=>[node.id,{x:i*123,y:-45}])),{x:42,y:-23,zoom:1.7},Object.fromEntries(definition.edges.map(edge=>[edge.id,[{x:40,y:70}]])));

test('strict transfer accepts canonical semantics with optional layout and rejects persistence metadata',()=>{
 const definition=workflow(),valid=envelope(definition);assert.equal(parse(valid).ok,true);assert.equal(parse({...valid,layout:layout(definition)}).ok,true);
 for(const field of ['fileSha','sha','revision','sourcePath','runHistory','credentials','runtimeState','anything'])assert.equal(parse({...valid,[field]:'private'}).ok,false,field);
 assert.equal(parse({...valid,definition:{...definition,fileSha:'private'}}).ok,false);
 for(const [key,value] of [['format','another-format'],['version',2],['version','1']])assert.equal(parse({...valid,[key]:value}).ok,false);
 assert.match(parse({...valid,version:2}).error,/Unsupported/);assert.match(parse({...valid,format:'wrong'}).error,/format/);
 assert.equal(parse({...valid,definition:{...definition,nodes:[]}}).ok,false);
 assert.equal(parse({...valid,definition:{...definition,nodes:[{...definition.nodes[0],config:{agentId:'actual-agent',credentials:'private'}}]}}).ok,false);
 assert.equal(parse({...valid,definition:{...definition,nodes:[{...definition.nodes[0],blockType:'publish-github-pr',config:null}]}}).ok,false);
 assert.equal(parseWorkflowTransfer('{private payload').ok,false);assert.equal(parseWorkflowTransfer('null').ok,false);
 assert.ok(parseWorkflowTransfer('x'.repeat(WORKFLOW_TRANSFER_MAX_BYTES+1)).error.length<200);
});

test('layout mismatch, unknown references, malformed/nonfinite/excessive values fail safely',()=>{
 const definition=workflow([agentNode('start'),agentNode('finish')]),valid={...envelope(definition),layout:layout(definition)};
 for(const invalid of [
  {...valid.layout,workflowId:'another'},
  {...valid.layout,positions:{ghost:{x:0,y:0}}},
  {...valid.layout,edgeWaypoints:{ghost:[{x:0,y:0}]}},
  {...valid.layout,positions:{start:{x:null,y:0}}},
  {...valid.layout,positions:{start:{x:1e100,y:0}}},
  {...valid.layout,viewport:{x:0,y:0,zoom:10}},
  {...valid.layout,edgeWaypoints:{'edge-0':Array.from({length:9},()=>({x:0,y:0}))}},
 ]){const result=parse({...valid,layout:invalid});assert.equal(result.ok,false);assert.match(result.error,/Layout|layout/)}
 assert.equal(workflowTransferSchema.safeParse({...valid,layout:{...valid.layout,viewport:{x:Infinity,y:0,zoom:1}}}).success,false);
 const partial=parse({...valid,layout:{...valid.layout,positions:{}}});assert.equal(partial.ok,true);assert.equal(hydrateWorkflowEditor(partial.transfer.definition,partial.transfer.layout,agents,reusable).nodes.length,2);
});

test('input bound accommodates maximum graph and large allowed text even with worst-case JSON escaping',()=>{
 // Every other node can be a PR publication with its maximum body, interleaved
 // with Agent sources, filling the maximum canonical node count.
 const nodes=Array.from({length:MAX_WORKFLOW_STEPS},(_,i)=>i%2===0?agentNode(`node-${i}`):({id:`node-${i}`,blockType:'publish-github-pr',blockVersion:1,config:{sourceNodeId:`node-${i-1}`,title:'x'.repeat(256),body:'\u0000'.repeat(65536),draft:true}}));
 const definition=workflow(nodes);definition.runInputTemplate='\u0000'.repeat(WORKFLOW_RUN_INPUT_MAX_LENGTH);workflowDefinitionV2Schema.parse(definition);
 const text=canonicalJson({...envelope(definition),layout:layout(definition)});assert.ok(Buffer.byteLength(text)<WORKFLOW_TRANSFER_MAX_BYTES);assert.equal(parseWorkflowTransfer(text).ok,true);
});

test('context is deterministic and projects only stable references and safe capabilities',()=>{
 const privateAgent={...agents[0],prompt:{source:'custom',text:'PRIVATE PROMPT'},masterPrompt:'MASTER PROMPT',adapterOptions:{secret:'SECRET',continueFrom:{runId:'PRIVATE RUN'}},credentials:'CREDENTIAL',securityProfileId:'PRIVATE SECURITY',fileSha:'PRIVATE SHA',sourcePath:'PRIVATE PATH'};
 const all=[privateAgent,{...agents[0],id:'compatible',name:'Compatible',agentContinueFrom:true},{...agents[0],id:'different',name:'Different',environmentKey:'other-private-environment'}, {id:'unsupported',name:'Unsupported',adapter:'openai-responses',connectionKey:'other-private-connection'}];
 const json=serializeWorkflowAuthoringContext(all,reusable),context=JSON.parse(json);
 assert.equal(json,serializeWorkflowAuthoringContext([...all].reverse(),[...reusable].reverse()));
 assert.equal(context.agents.find(agent=>agent.id==='actual-agent').id,'actual-agent');assert.equal(context.reusableWorkflows[0].id,'actual-reusable');
 for(const text of ['PRIVATE PROMPT','MASTER PROMPT','SECRET','CREDENTIAL','PRIVATE RUN','PRIVATE SECURITY','PRIVATE SHA','PRIVATE PATH','private-connection','private-environment','connectionKey','environmentKey','adapterOptions','masterPrompt','sourcePath','fileSha'])assert.equal(json.includes(text),false,text);
 const capability=id=>context.agents.find(agent=>agent.id===id).capabilities;
 assert.equal(capability('actual-agent').conversationCompatibilityGroup,capability('compatible').conversationCompatibilityGroup);
 assert.notEqual(capability('actual-agent').conversationCompatibilityGroup,capability('different').conversationCompatibilityGroup);
 assert.equal(capability('compatible').conversationContinuation,false);assert.equal(capability('unsupported').conversationCompatibilityGroup,undefined);
 assert.equal(capability('actual-agent').managedPublication,isAgentPublishAuthoringEligible({connectionKey:agents[0].connectionKey,adapterOptions:{environmentKey:agents[0].environmentKey,managedGit:agents[0].managedGit}},[{key:'private-connection',adapter:'codex-runner'}]));
 assert.equal(workflowAuthoringContextSchema.safeParse({...context,credentials:'no'}).success,false);
});

test('context includes all registered block contracts, ports and valid configuration guidance',()=>{
 const context=createWorkflowAuthoringContext(agents,reusable),metadata=workflowBlockRegistry.metadata().sort((a,b)=>a.type.localeCompare(b.type)||a.version-b.version);
 assert.deepEqual(context.blocks,metadata);
 assert.deepEqual(context.blocks.map(block=>`${block.type}@${block.version}`).sort(),['agent@1','agent@2','agent@3','approval@1','condition@1','join@1','publish-github-pr@1','subworkflow@1'].sort());
 for(const block of context.blocks){assert.ok(block.authoring.guide.length>10);assert.doesNotThrow(()=>workflowBlockRegistry.validate(block.type,block.version,block.authoring.configTemplate));assert.ok(block.interface.inputs.some(port=>port.default));assert.ok(block.interface.outputs.some(port=>port.default))}
 assert.equal(context.blocks.find(block=>block.type==='join').interface.inputs[0].multiple,true);
});

test('reusable candidates exclude unexposed and invalid compositions',()=>{
 const valid={...workflow(),id:'valid'},hidden={...workflow(),id:'hidden',exposableAsBlock:false},missing={...workflow([{id:'call',blockType:'subworkflow',blockVersion:1,config:{workflowId:'not-here'}}]),id:'missing'};
 assert.deepEqual(reusableWorkflowAuthoringCandidates([hidden,missing,valid]).map(item=>item.id),['valid']);
});

function roundTrip(definition){
 const parsed=parse({...envelope(definition),layout:layout(definition)});assert.equal(parsed.ok,true);
 const state=hydrateWorkflowEditor(parsed.transfer.definition,parsed.transfer.layout,agents,reusable),result=workflowDefinitionFromEditor(state.fields,state.nodes,state.edges);
 const expected=workflowDefinitionV2Schema.parse(definition);
 // Editor makes registry default ports explicit, as when constructed manually.
 for(const edge of expected.edges){const source=expected.nodes.find(node=>node.id===edge.source),target=expected.nodes.find(node=>node.id===edge.target);edge.sourcePort=workflowBlockRegistry.port(source.blockType,source.blockVersion,'outputs',edge.sourcePort);edge.targetPort=workflowBlockRegistry.port(target.blockType,target.blockVersion,'inputs',edge.targetPort)}
 assert.deepEqual(result,expected);assert.deepEqual(state.viewport,parsed.transfer.layout.viewport);assert.deepEqual(state.edgeWaypoints,parsed.transfer.layout.edgeWaypoints);assert.deepEqual(Object.fromEntries(state.nodes.map(node=>[node.id,node.position])),parsed.transfer.layout.positions);return state;
}

test('shared hydration preserves linear settings, context, conversation, approval, reusable and publication',()=>{
 roundTrip(workflow([
  agentNode('start','actual-agent',2,{context:{publishOutput:true,includeRunInput:true,includeNodeOutputs:[]}}),
  {id:'review',blockType:'approval',blockVersion:1,config:{message:'Approve this exact text?'}},
  {id:'call',blockType:'subworkflow',blockVersion:1,config:{workflowId:'actual-reusable'}},
  agentNode('finish','actual-agent',3,{context:{publishOutput:false,includeRunInput:true,includeNodeOutputs:['start']},conversation:{sourceNodeId:'start'}}),
  {id:'publish',blockType:'publish-github-pr',blockVersion:1,config:{sourceNodeId:'finish',title:'Ship it',body:'Exact body\n',draft:false}},
 ]));
});

test('condition true/false ports and Join survive shared hydration',()=>{
 roundTrip(workflow([agentNode('start'),{id:'check',blockType:'condition',blockVersion:1,config:{operator:'contains',value:'approved',caseSensitive:true}},agentNode('yes'),agentNode('no'),agentNode('finish')],[{id:'one',source:'start',target:'check'},{id:'yes',source:'check',sourcePort:'true',target:'yes'},{id:'no',source:'check',sourcePort:'false',target:'no'},{id:'yes-end',source:'yes',target:'finish'},{id:'no-end',source:'no',target:'finish'}]));
 roundTrip(workflow([agentNode('start'),agentNode('left'),agentNode('right'),{id:'join',blockType:'join',blockVersion:1,config:{}},agentNode('finish')],[{id:'left',source:'start',target:'left'},{id:'right',source:'start',target:'right'},{id:'join-left',source:'left',target:'join'},{id:'join-right',source:'right',target:'join'},{id:'end',source:'join',target:'finish'}]));
});

test('missing references retain actual IDs; repair and compatibility preflight are observable',()=>{
 const definition=workflow([agentNode('missing','unknown-agent'),{id:'call',blockType:'subworkflow',blockVersion:1,config:{workflowId:'unknown-workflow'}},agentNode('finish','actual-agent',3,{conversation:{sourceNodeId:'missing'}}),{id:'publish',blockType:'publish-github-pr',blockVersion:1,config:{sourceNodeId:'finish',title:'Ship',body:'',draft:true}}]);
 const state=hydrateWorkflowEditor(definition,undefined,agents,reusable);assert.match(state.nodes[0].data.label,/Missing Agent: unknown-agent/);assert.equal(state.nodes[1].data.workflowId,'unknown-workflow');
 const errors=workflowAuthoringPreflight(definition,agents,reusable,['imported']);for(const fragment of ['Missing Agent: unknown-agent','Missing reusable Workflow: unknown-workflow','Incompatible conversation','already exists'])assert.ok(errors.some(error=>error.includes(fragment)));
 const repaired=structuredClone(definition);repaired.id='unique';repaired.nodes[0].config.agentId='actual-agent';repaired.nodes[1].config.workflowId='actual-reusable';assert.deepEqual(workflowAuthoringPreflight(repaired,agents,reusable),[]);
 assert.ok(workflowAuthoringPreflight(repaired,[{...agents[0],publishEligible:false}],reusable).some(error=>error.includes('not eligible')));
 const semantics=workflowDefinitionFromEditor({...state.fields,id:'renamed'},state.nodes,state.edges),savedLayout=normalizeWorkflowLayout(semantics,Object.fromEntries(state.nodes.map(node=>[node.id,node.position])),state.viewport,state.edgeWaypoints);assert.equal(semantics.id,'renamed');assert.equal(savedLayout.workflowId,'renamed');
});
