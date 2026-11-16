import test from 'node:test';
import assert from 'node:assert/strict';
import {assertNoSecrets,ArtifactSecretRejectedError,prepareArtifactWrite} from '../lib/artifact-repository.ts';
import {observedText} from '../lib/adt-observability.ts';
import {KnowledgeProposalStore} from '../lib/advisor-knowledge-proposals.ts';
import {knowledgeError} from '../lib/advisor-knowledge-http.ts';
import {sensitiveFormats} from './support/sensitive-format-fixtures.mjs';
import {knowledgeFixture,document} from './support/knowledge-fixture.mjs';
import {context,database} from './support/advisor-fixtures.mjs';

test('shared rejection protects bounded observations and Artifact Library writes for common credential formats',()=>{
 const metadata={id:'safe-id',title:'Safe',type:'prompt',tags:[],aliases:[]};
 for(const [label,secret] of sensitiveFormats){
  assert.throws(()=>assertNoSecrets(secret),ArtifactSecretRejectedError,label);
  assert.throws(()=>prepareArtifactWrite(metadata,secret),ArtifactSecretRejectedError,label);
  // Inspect the whole selected record before slicing: credentials beyond the requested page still block disclosure.
  const observation=observedText(`Ordinary content\n${secret}`,8,0);
  assert.deepEqual(observation,{available:false,reason:'secret_safety_check'},label);
  assert.equal(JSON.stringify(observation).includes(secret),false);
 }
 const unverified=observedText('Private customer notes with no recognised credential syntax',12);
 assert.equal(unverified.available,true);assert.equal(unverified.safety,'unverified_sensitive_content');assert.equal(unverified.disclosure,'exact_call_human_approval_required');assert.equal(unverified.truncated,true);assert.equal(unverified.text.length,12);
 assert.equal(observedText('x'.repeat(65537),10).reason,'content_limit');
});
test('even reviewed knowledge cannot publish detected credentials; consent is consumed and errors contain no rejected data',async t=>{
 const db=await database(t),store=new KnowledgeProposalStore(db,context,{githubId:123,login:'reviewer',sessionId:'human-browser'});
 for(const [label,secret] of sensitiveFormats){
  const git=knowledgeFixture(),draft=await store.save({document:{...document(),body:`Reviewed but forbidden: ${secret}`},expectedSha:null}),review=await store.review(draft.id,draft.revision);
  let failure;try{await store.publish(draft.id,draft.revision,review.reviewToken,(doc,sha,actor)=>git.repository.publish(doc,sha,actor))}catch(error){failure=error}
  assert.equal(failure?.message,'knowledge_secret_rejected',label);assert.equal(git.writes.length,0,label);assert.equal(git.requests.length,0,label);assert.equal((await store.get(draft.id)).state,'draft');
  const response=knowledgeError(failure);assert.equal(response.status,400);assert.equal(JSON.stringify(await response.json()).includes(secret),false);
  await assert.rejects(store.publish(draft.id,draft.revision,review.reviewToken,()=>assert.fail('Consumed consent cannot publish')),/knowledge_review_required/);
 }
 // A corrected proposal needs a new save/review and can publish normally.
 const git=knowledgeFixture(),draft=await store.save({document:document('reviewed-safe'),expectedSha:null}),review=await store.review(draft.id,draft.revision);
 await store.publish(draft.id,draft.revision,review.reviewToken,(doc,sha,actor)=>git.repository.publish(doc,sha,actor));assert.equal(git.writes.length,1);
});
