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

test('Markdown Agent content is rejected from the canonical library',()=>{assert.throws(()=>parseArtifactMarkdown(front().replace('type: prompt','type: agent'),'prompts/example.md'))});

test('canonical serialization preserves type and sourceId without lifecycle status',()=>{const markdown=serializeArtifactMarkdown({id:'variation',title:'Variation',type:'prompt',tags:[],aliases:[],sourceId:'example'},'Body');assert.match(markdown,/type: prompt/);assert.match(markdown,/sourceId: example/);assert.doesNotMatch(markdown,/^status:/m)});

test('external validator rejects retired Markdown locations and lifecycle status',async()=>{const root=await mkdtemp(join(tmpdir(),'adt-phase16-'));await mkdir(join(root,'prompts'));await mkdir(join(root,'artifacts','agents'),{recursive:true});await writeFile(join(root,'prompts','example.md'),front());await writeFile(join(root,'artifacts','agents','helper.md'),front().replace('id: example','id: helper'));let result=await validateExternalArtifactRepository(root);assert.equal(result.valid,false);assert.ok(result.errors.some(error=>error.file==='artifacts/agents/helper.md'));await writeFile(join(root,'prompts','invalid.md'),front('status: draft\n').replace('id: example','id: invalid'));result=await validateExternalArtifactRepository(root);assert.equal(result.valid,false);assert.ok(result.errors.some(error=>error.file==='prompts/invalid.md'&&/status/i.test(error.reason)))});
test('executable Agent and Workflow definitions retain independent required draft status',()=>{const agent={schemaVersion:2,id:'agent',name:'Agent',description:'',status:'draft',prompt:{source:'custom',text:'Do work'},connectionKey:'openai'};assert.equal(agentDefinitionSchema.parse(agent).status,'draft');assert.throws(()=>agentDefinitionSchema.parse({...agent,status:undefined}));assert.throws(()=>agentDefinitionSchema.parse({...agent,status:'production'}));const workflow={schemaVersion:2,id:'flow',name:'Flow',description:'',status:'draft',nodes:[{id:'step',blockType:'agent',blockVersion:1,config:{agentId:'agent'}}],edges:[],limits:{maxStepExecutions:1}};assert.equal(workflowDefinitionSchema.parse(workflow).status,'draft');assert.throws(()=>workflowDefinitionSchema.parse({...workflow,status:undefined}));assert.throws(()=>workflowDefinitionSchema.parse({...workflow,status:'production'}))});
