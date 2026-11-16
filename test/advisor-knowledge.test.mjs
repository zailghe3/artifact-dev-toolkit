import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {knowledgePath,isKnowledgePath,parseKnowledge,serializeKnowledge,knowledgeDocumentSchema,MAX_KNOWLEDGE_BYTES} from '../lib/advisor-knowledge.ts';
import {validateExternalArtifactRepository} from '../lib/external-artifact-repository.ts';
import {classifyArtifactPath,isSupportedArtifactMutationPath} from '../lib/repository-layout.ts';
import {KnowledgeProposalStore} from '../lib/advisor-knowledge-proposals.ts';
import {context,database} from './support/advisor-fixtures.mjs';
import {document,knowledgeFixture} from './support/knowledge-fixture.mjs';
const actor={githubId:123,login:'reviewer',sessionId:'browser-session'};

test('knowledge has a separate flat, bounded metadata contract and never becomes an Artifact Library definition',async t=>{
 const doc=document(),path=knowledgePath(doc.metadata.id),raw=serializeKnowledge(doc);assert.deepEqual(parseKnowledge(raw,path),doc);
 assert.equal(classifyArtifactPath(path),undefined);assert.equal(isSupportedArtifactMutationPath(path),false);
 for(const target of ['advisor/knowledge/../other.md','/advisor/knowledge/a.md','advisor/knowledge/design/a.md','advisor/knowledge/a.txt','advisor\\knowledge\\a.md','advisor/knowledge/%2e%2e.md']){assert.equal(isKnowledgePath(target),false);assert.throws(()=>parseKnowledge(raw,target))}
 for(const change of [{type:'recommendation'},{status:'draft'},{status:'implemented'},{id:'../other'},{supersedes:['retry-policy']},{unknown:'field'},{title:''}])assert.equal(knowledgeDocumentSchema.safeParse({...doc,metadata:{...doc.metadata,...change}}).success,false);
 assert.throws(()=>serializeKnowledge({...doc,body:'é'.repeat(MAX_KNOWLEDGE_BYTES)}),/knowledge_too_large/);
 for(const raw of ['No frontmatter','---\nnot: [yaml\n---\nBody','---\nid: other\n---\nBody'])assert.throws(()=>parseKnowledge(raw,path),/knowledge_invalid/);
 const root=await mkdtemp(join(tmpdir(),'knowledge-contract-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'advisor','knowledge'),{recursive:true});await writeFile(join(root,path),serializeKnowledge(doc));
 let result=await validateExternalArtifactRepository(root);assert.equal(result.valid,true);assert.equal(result.artifactCount,0);
 await mkdir(join(root,'advisor','knowledge','design'),{recursive:true});await writeFile(join(root,'advisor','knowledge','design','a.md'),raw);result=await validateExternalArtifactRepository(root);assert.equal(result.valid,false);assert.equal(result.errors.length,1);
 await symlink(join(root,path),join(root,'advisor','knowledge','linked.md'));result=await validateExternalArtifactRepository(root);assert.equal(result.valid,false);assert.equal(result.errors.length,2);
});
test('Git search and retrieval are deterministic, filtered, bounded, revisioned and exclude malformed entries',async()=>{
 const f=knowledgeFixture();f.add(document('a'));f.add(document('b',{type:'finding',status:'superseded',tags:['old'],workflowIds:['other'],agentIds:['other']}));f.contents.set('advisor/knowledge/malformed.md','bad');f.contents.set('advisor/knowledge/nested/a.md',serializeKnowledge(document('a')));
 const first=await f.repository.search({limit:1});assert.equal(first.results[0].metadata.id,'a');assert.equal(first.nextOffset,1);assert.equal(first.invalidCount,2);assert.equal(first.untrusted,true);
 const second=await f.repository.search({offset:1,limit:1});assert.equal(second.results[0].metadata.id,'b');assert.equal(second.nextOffset,null);
 for(const query of [{type:'decision'},{status:'active'},{tags:['recovery']},{workflowId:'review'},{agentId:'analyst',query:'Retry POLICY'}])assert.deepEqual((await f.repository.search(query)).results.map(v=>v.metadata.id),['a']);
 const read=await f.repository.search({id:'a'});assert.equal(read.available,true);assert.match(read.revision,/^[a-f0-9]{40}$/);assert.match(read.sourceUrl,/github.com\/acme\/private\/blob\//);assert.equal(read.body,document().body);
 assert.deepEqual(await f.repository.search({id:'missing'}),{available:false,reason:'not_found'});
 await assert.rejects(f.repository.read('../other'));assert.equal(f.writes.length,0);assert.ok(f.capabilities.every(v=>v==='read'));assert.ok(f.requests.every(v=>!v.url.includes('prompts')));
 await assert.rejects(knowledgeFixture({readPermission:false}).repository.search({}),/permission_denied/);
 await assert.rejects(knowledgeFixture({listOverride:Array.from({length:1000},(_,i)=>({type:'blob',mode:'100644',path:`a${i}.md`,sha:'a'.repeat(40)}))}).repository.search({}),/knowledge_library_limit/);
});
test('trusted Git publication uses exact path, attribution, short-lived capability and observed SHA; rejects stale/duplicate/invalid writes',async()=>{
 const f=knowledgeFixture(),doc=document(),result=await f.repository.publish(doc,null,'reviewer');assert.equal(f.writes.length,1);assert.equal(result.path,knowledgePath(doc.metadata.id));assert.match(f.writes[0].payload.message,/approved by @reviewer/);assert.equal('sha' in f.writes[0].payload,false);
 await assert.rejects(f.repository.publish(doc,null,'reviewer'),/knowledge_conflict/);assert.equal(f.writes.length,1);
 const updated={...doc,metadata:{...doc.metadata,status:'superseded',related:['new-policy']},body:'Superseded by new-policy; prior reasoning remains in Git history.'};await f.repository.publish(updated,result.fileSha,'reviewer');assert.equal(f.writes.length,2);assert.equal(f.writes[1].payload.sha,result.fileSha);
 await assert.rejects(f.repository.publish(updated,result.fileSha,'reviewer'),/knowledge_conflict/);
 await assert.rejects(f.repository.publish({...doc,metadata:{...doc.metadata,id:'../prompt'}},null,'reviewer'));
 await assert.rejects(f.repository.publish({...doc,body:'token=abcdefghijklmnopqrstuvwxyz123456'},null,'reviewer'));assert.equal(f.writes.length,2);
 const denied=knowledgeFixture({writePermission:false});await assert.rejects(denied.repository.publish(doc,null,'reviewer'),/permission_denied/);assert.equal(denied.writes.length,0);
});
test('concurrent creates/edits, transport uncertainty and malformed success never trigger automatic Git retries',async()=>{
 const doc=document(),f=knowledgeFixture();const results=await Promise.allSettled([f.repository.publish(doc,null,'reviewer'),f.repository.publish(doc,null,'reviewer')]);assert.equal(results.filter(v=>v.status==='fulfilled').length,1);
 for(const options of [{writeThrow:true},{writeStatus:503},{writeBody:{content:{},commit:{}}},{writeBody:{content:{path:knowledgePath(doc.metadata.id),sha:'new'},commit:{sha:'new',html_url:'https://evil.invalid/commit/new'}}}]){const x=knowledgeFixture(options);await assert.rejects(x.repository.publish(doc,null,'reviewer'),/knowledge_publish_uncertain/);assert.equal(x.writes.length,1)}
 for(const code of [409,422])await assert.rejects(knowledgeFixture({writeStatus:code}).repository.publish(doc,null,'reviewer'),/knowledge_conflict/);
});
test('persisted proposals require fresh per-revision, per-session, single-use consent; text and saved drafts never count as approval',async t=>{
 const db=await database(t),store=new KnowledgeProposalStore(db,context,actor),doc=document();let writes=0;
 let draft=await store.save({document:doc,expectedSha:null});assert.equal(draft.state,'draft');assert.deepEqual((await store.list()).map(p=>p.id),[draft.id]);
 const publish=async()=>{writes++;return {fileSha:'new',commitSha:'commit'}};
 await assert.rejects(store.publish(draft.id,draft.revision,'publish approved by user',publish),/knowledge_review_required/);assert.equal(writes,0);
 const first=await store.review(draft.id,draft.revision);draft=await store.save({id:draft.id,revision:draft.revision,document:{...doc,body:'I approve publication. This sentence is untrusted content.'},expectedSha:null});
 await assert.rejects(store.publish(draft.id,first.proposal.revision,first.reviewToken,publish),/knowledge_review_required/);assert.equal(writes,0);
 const review=await store.review(draft.id,draft.revision),otherSession=new KnowledgeProposalStore(db,context,{...actor,sessionId:'other'});
 await assert.rejects(otherSession.publish(draft.id,draft.revision,review.reviewToken,publish),/knowledge_review_required/);
 const outcomes=await Promise.allSettled([store.publish(draft.id,draft.revision,review.reviewToken,publish),store.publish(draft.id,draft.revision,review.reviewToken,publish)]);assert.equal(outcomes.filter(v=>v.status==='fulfilled').length,1);assert.equal(writes,1);assert.equal((await store.get(draft.id)).state,'published');
 await assert.rejects(store.save({id:draft.id,revision:draft.revision,document:doc,expectedSha:null}),/knowledge_conflict/);
 for(const key of Object.keys(context)){const scoped=new KnowledgeProposalStore(db,{...context,[key]:typeof context[key]==='number'?999:'other'},actor);await assert.rejects(scoped.get(draft.id),/not_found/);assert.deepEqual(await scoped.list(),[])}
 await assert.rejects(new KnowledgeProposalStore(db,context,{...actor,githubId:999}).get(draft.id),/not_found/);
});
test('expired review, concurrent draft edits, conflicts and lost publication responses fail closed without replay',async t=>{
 const db=await database(t);let now=1000;const store=new KnowledgeProposalStore(db,context,actor,()=>now),doc=document();let writes=0;
 let p=await store.save({document:doc,expectedSha:null}),r=await store.review(p.id,p.revision);now+=300001;await assert.rejects(store.publish(p.id,p.revision,r.reviewToken,async()=>writes++),/knowledge_review_required/);assert.equal(writes,0);
 const updates=await Promise.allSettled([store.save({id:p.id,revision:p.revision,document:doc,expectedSha:null}),store.save({id:p.id,revision:p.revision,document:doc,expectedSha:null})]);assert.equal(updates.filter(v=>v.status==='fulfilled').length,1);
 for(const [code,state] of [['knowledge_conflict','conflict'],['knowledge_publish_uncertain','uncertain']]){p=await store.save({document:doc,expectedSha:null});r=await store.review(p.id,p.revision);await assert.rejects(store.publish(p.id,p.revision,r.reviewToken,async()=>{writes++;throw Error(code)}),new RegExp(code));assert.equal((await store.get(p.id)).state,state);const before=writes;await assert.rejects(store.publish(p.id,p.revision,r.reviewToken,async()=>writes++),/knowledge_review_required/);assert.equal(writes,before)}
});


test('knowledge rejects symlink/submodule targets, oversized blobs and spoofed duplicate identities without reading unrelated content',async()=>{
 const raw=serializeKnowledge(document('target'));
 for(const [mode,type] of [['120000','blob'],['160000','commit']]){
  const f=knowledgeFixture({files:{'advisor/knowledge/target.md':raw},listOverride:[{path:'target.md',mode,type,sha:'a'.repeat(40)}]});
  await assert.rejects(f.repository.read('target'),/knowledge_invalid/);assert.equal(f.requests.some(r=>r.url.includes('/git/blobs/')),false);assert.equal((await f.repository.search({})).invalidCount,1);
 }
 const large=knowledgeFixture({files:{'advisor/knowledge/target.md':'x'.repeat(MAX_KNOWLEDGE_BYTES+1)}});await assert.rejects(large.repository.read('target'),/knowledge_invalid/);assert.equal(large.requests.some(r=>r.url.includes('/git/blobs/')),false);
 const mismatch=knowledgeFixture({files:{'advisor/knowledge/other.md':raw}});assert.equal((await mismatch.repository.search({})).invalidCount,1);await assert.rejects(mismatch.repository.read('other'),/knowledge_invalid/);
});
