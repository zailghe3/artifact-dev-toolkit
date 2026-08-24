import test from 'node:test';
import assert from 'node:assert/strict';
import { handleLifecyclePreview } from '../lib/lifecycle-preview-route-handler.ts';
import { parseArtifactMarkdown } from '../lib/artifact-contract.ts';

const access={owner:'o',repo:'r',repositoryId:1};
const metadata={id:'example',title:'Example',description:'',type:'prompt',tags:['one'],aliases:[],sourceId:'source',createdAt:'2026-08-24T00:00:00.000Z'};
const stored=parseArtifactMarkdown(`---\nid: example\ntitle: Example\ntype: prompt\nstatus: production\ntags: [one]\naliases: []\nsourceId: source\ncreatedAt: 2026-08-24T00:00:00.000Z\n---\nStored body\n`,'prompts/example.md','future');
const request=(value)=>new Request('https://example.test/api/artifacts/preview',{method:'POST',body:typeof value==='string'?value:JSON.stringify(value)});
const dependencies=(overrides={})=>({authorize:async()=>({access,session:{login:'octocat'}}),loadArtifact:async()=>({artifact:stored,currentFileSha:'observed-sha'}),...overrides});

test('preview authorizes before parsing or repository loading',async()=>{let loads=0;const denied=new Response('denied',{status:401}),response=await handleLifecyclePreview(request('{'), 'example', dependencies({authorize:async()=>denied,loadArtifact:async()=>{loads++;throw new Error('must not load')}}));assert.equal(response,denied);assert.equal(loads,0)});

test('statusless create preview renders canonical metadata without mutation',async()=>{let loads=0;const response=await handleLifecyclePreview(request({metadata:{id:'new',title:'New',type:'prompt',tags:[],aliases:[]},body:'**Preview**'}),undefined,dependencies({loadArtifact:async()=>{loads++;throw new Error('must not load')}}));assert.equal(response.status,200);const value=await response.json();assert.equal('status' in value.metadata,false);assert.equal(value.metadata.id,'new');assert.match(value.bodyHtml,/<strong>Preview<\/strong>/);assert.equal(loads,0)});

test('edit preview requires the exact observed SHA and performs no mutation',async()=>{let loads=0;const deps=dependencies({loadArtifact:async()=>{loads++;return {artifact:stored,currentFileSha:'observed-sha'}}});let response=await handleLifecyclePreview(request({metadata,body:'Updated',currentFileSha:'stale-sha'}),'example',deps);assert.equal(response.status,409);assert.equal((await response.json()).code,'write_conflict');response=await handleLifecyclePreview(request({metadata,body:'Updated',currentFileSha:'observed-sha'}),'example',deps);assert.equal(response.status,200);const value=await response.json();assert.equal('status' in value.metadata,false);assert.equal(loads,2)});

test('legacy stored status does not weaken immutable edit-preview metadata',async()=>{for(const change of [{id:'renamed'},{type:'template'},{sourceId:'other'},{createdAt:'2026-08-25T00:00:00.000Z'}]){const response=await handleLifecyclePreview(request({metadata:{...metadata,...change},body:'Updated',currentFileSha:'observed-sha'}),'example',dependencies());assert.equal(response.status,400);assert.equal((await response.json()).code,'validation_failed')}});
