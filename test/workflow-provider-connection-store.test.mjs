import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {D1WorkflowProviderConnectionStore} from '../lib/workflow-provider-connection-store.ts';

const rootA=Buffer.alloc(32,31).toString('base64');
const rootB=Buffer.alloc(32,32).toString('base64');
const credential='unit-test-provider-credential-7f31';

async function fixture(){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:{DB:crypto.randomUUID()}}),db=await mf.getD1Database('DB'),sql=await readFile(new URL('../migrations/0004_create_workflow_provider_connections.sql',import.meta.url),'utf8');
 await db.batch(sql.split(';').map(value=>value.trim()).filter(Boolean).map(statement=>db.prepare(statement)));
 return{mf,db,store:new D1WorkflowProviderConnectionStore(db,rootA)};
}
async function row(db){return db.prepare('SELECT * FROM workflow_provider_connections WHERE connection_key = ?').bind('openai-primary').first();}

test('D1 provider store persists, updates, rotates, and removes encrypted credentials',async t=>{
 const{mf,db,store}=await fixture();t.after(()=>mf.dispose());
 await store.upsertConnection({connectionKey:'openai-primary',adapter:'openai-responses',model:'snapshotted-model',credential});
 const first=await row(db),serialized=JSON.stringify(first);
 assert.notEqual(first.encrypted_credential,credential);assert.ok(first.credential_iv);assert.equal(first.encryption_version,1);assert.equal(first.default_model,'snapshotted-model');assert.doesNotMatch(serialized,new RegExp(credential));
 const fresh=new D1WorkflowProviderConnectionStore(db,rootA);assert.equal((await fresh.resolveCredential('openai-primary')).credential,credential);assert.equal((await fresh.getSafeDescriptor('openai-primary')).enabled,true);
 await fresh.upsertConnection({connectionKey:'openai-primary',adapter:'openai-responses',model:'updated-model'});const metadata=await row(db);assert.equal(metadata.default_model,'updated-model');assert.equal(metadata.encrypted_credential,first.encrypted_credential);assert.equal(metadata.credential_iv,first.credential_iv);assert.equal((await fresh.resolveCredential('openai-primary')).credential,credential);
 const replacement='replacement-unit-test-credential-91aa';await fresh.upsertConnection({connectionKey:'openai-primary',adapter:'openai-responses',model:'updated-model',credential:replacement});const rotated=await row(db);assert.notEqual(rotated.encrypted_credential,first.encrypted_credential);assert.notEqual(rotated.credential_iv,first.credential_iv);assert.doesNotMatch(JSON.stringify(rotated),new RegExp(`${credential}|${replacement}`));assert.equal((await fresh.resolveCredential('openai-primary')).credential,replacement);
 await fresh.deleteConnection('openai-primary');assert.equal(await row(db),null);assert.equal((await fresh.getSafeDescriptor('openai-primary')).enabled,false);await assert.rejects(()=>fresh.resolveCredential('openai-primary'),/^Error: connection_unavailable$/);
});

test('safe descriptors fail closed for unusable encrypted rows and unknown keys',async t=>{
 const{mf,db,store}=await fixture();t.after(()=>mf.dispose());await store.upsertConnection({connectionKey:'openai-primary',adapter:'openai-responses',model:'safe-model',credential});
 for(const candidate of [new D1WorkflowProviderConnectionStore(db,rootB),new D1WorkflowProviderConnectionStore(db,undefined),new D1WorkflowProviderConnectionStore(db,'malformed')]){const safe=await candidate.getSafeDescriptor('openai-primary');assert.equal(safe.enabled,false);assert.doesNotMatch(JSON.stringify(safe),/credential|ciphertext|encryption|unit-test/i);await assert.rejects(()=>candidate.resolveCredential('openai-primary'),/^Error: connection_unavailable$/);}
 assert.equal(await store.getSafeDescriptor('arbitrary-provider'),undefined);
 for(const mutation of ["UPDATE workflow_provider_connections SET encrypted_credential = 'broken'","UPDATE workflow_provider_connections SET credential_iv = 'broken'","UPDATE workflow_provider_connections SET adapter = 'changed-aad'","UPDATE workflow_provider_connections SET encryption_version = 2"]){await db.prepare(mutation).run();const safe=await store.getSafeDescriptor('openai-primary');assert.equal(safe.enabled,false);await assert.rejects(()=>store.resolveCredential('openai-primary'),/^Error: connection_unavailable$/);await db.prepare('DELETE FROM workflow_provider_connections').run();await store.upsertConnection({connectionKey:'openai-primary',adapter:'openai-responses',model:'safe-model',credential});}
});

test('known OpenAI descriptor remains visible when provider storage is empty',async t=>{const{mf,store}=await fixture();t.after(()=>mf.dispose());assert.deepEqual(await store.listSafeDescriptors(),[{key:'openai-primary',name:'OpenAI Responses',adapter:'openai-responses',endpoint:'https://api.openai.com/v1',enabled:false,capabilities:{asynchronous:true,cancellation:true}}]);});
