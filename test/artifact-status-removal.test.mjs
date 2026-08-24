import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseArtifactMarkdown,serializeArtifactMarkdown,ArtifactMarkdownParseError} from '../lib/artifact-contract.ts';
import {validateExternalArtifactRepository} from '../lib/external-artifact-repository.ts';
import {agentDefinitionSchema,workflowDefinitionSchema} from '../lib/workflow-definitions.ts';

const front=(extra='')=>`---\nid: example\ntitle: Example\ntype: prompt\n${extra}tags: []\naliases: []\n---\nBody\n`;

test('canonical statusless Artifact Library Markdown parses normally',()=>{const artifact=parseArtifactMarkdown(front('sourceId: source\ncreatedAt: 2026-08-24T00:00:00.000Z\n'),'prompts/example.md','future');assert.equal(artifact.type,'prompt');assert.equal(artifact.sourceId,'source');assert.equal(artifact.createdAt,'2026-08-24T00:00:00.000Z');assert.equal('status' in artifact,false)});

test('every top-level Artifact Library status value is rejected on read',()=>{for(const status of ['draft','production','archived','other'])assert.throws(()=>parseArtifactMarkdown(front(`status: ${status}\n`),'prompts/example.md','future'),error=>error instanceof ArtifactMarkdownParseError&&error.code==='invalid_metadata')});

test('unrelated additional metadata retains its existing non-strict handling',()=>{const artifact=parseArtifactMarkdown(front('owner: team\n'),'prompts/example.md','future');assert.equal('owner' in artifact,false)});

test('statusless Markdown Agent content remains valid at the legacy Agent path',()=>{const artifact=parseArtifactMarkdown(front().replace('type: prompt','type: agent'),'artifacts/agents/example.md','legacy');assert.equal(artifact.type,'agent');assert.equal(artifact.layout,'legacy')});

test('canonical serialization preserves type and sourceId without lifecycle status',()=>{const markdown=serializeArtifactMarkdown({id:'variation',title:'Variation',type:'prompt',tags:[],aliases:[],sourceId:'example'},'Body');assert.match(markdown,/type: prompt/);assert.match(markdown,/sourceId: example/);assert.doesNotMatch(markdown,/^status:/m)});

test('external validator accepts statusless transitional layouts and rejects status with a path-associated error',async()=>{const root=await mkdtemp(join(tmpdir(),'adt-phase3-'));await mkdir(join(root,'prompts'));await mkdir(join(root,'artifacts','agents'),{recursive:true});await writeFile(join(root,'prompts','example.md'),front());await writeFile(join(root,'artifacts','agents','helper.md'),front().replace('id: example','id: helper').replace('type: prompt','type: agent'));assert.deepEqual(await validateExternalArtifactRepository(root),{valid:true,artifactCount:2,errors:[]});await writeFile(join(root,'prompts','invalid.md'),front('status: draft\n').replace('id: example','id: invalid'));const result=await validateExternalArtifactRepository(root);assert.equal(result.valid,false);assert.equal(result.artifactCount,2);assert.equal(result.errors[0].file,'prompts/invalid.md');assert.match(result.errors[0].reason,/status/i)});

test('executable Agent and Workflow definitions retain independent required draft status',()=>{const agent={schemaVersion:2,id:'agent',name:'Agent',description:'',status:'draft',prompt:{source:'custom',text:'Do work'},connectionKey:'openai'};assert.equal(agentDefinitionSchema.parse(agent).status,'draft');assert.throws(()=>agentDefinitionSchema.parse({...agent,status:undefined}));assert.throws(()=>agentDefinitionSchema.parse({...agent,status:'production'}));const workflow={schemaVersion:1,id:'flow',name:'Flow',description:'',status:'draft',steps:[{id:'step',name:'Step',agentId:'agent',input:{source:'run_input'},onSuccess:{type:'complete'},onFailure:{type:'fail'}}],result:{source:'step_output',stepId:'step'},limits:{maxStepExecutions:1}};assert.equal(workflowDefinitionSchema.parse(workflow).status,'draft');assert.throws(()=>workflowDefinitionSchema.parse({...workflow,status:undefined}));assert.throws(()=>workflowDefinitionSchema.parse({...workflow,status:'production'}))});
