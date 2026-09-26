import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {
  MAX_PROVIDER_CREDENTIAL_LENGTH,
  ProviderCredentialVaultError,
  decryptVaultCredential,
  encryptVaultCredential,
  providerCredentialVaultV1KeyResolver,
} from '../lib/provider-credential-vault-crypto.ts';
import {
  D1ProviderCredentialVault,
  ProviderCredentialVaultServiceError,
  generateProviderCredentialVaultSecretId,
  isProviderCredentialVaultSecretId,
} from '../lib/provider-credential-vault.ts';
import {WorkIqOAuthStateStore} from '../lib/work-iq-oauth.ts';

const keyA=Buffer.alloc(32,41).toString('base64'),keyB=Buffer.alloc(32,42).toString('base64');
const credential='unit-test-vault-provider-credential-4ef8';
const code=expected=>error=>error?.code===expected;

async function fixture(options={}){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:{DB:crypto.randomUUID()}}),db=await mf.getD1Database('DB');
 const sql=await readFile(new URL('../migrations/0009_create_provider_credential_vault.sql',import.meta.url),'utf8');
 await db.batch(sql.split(';').map(value=>value.trim()).filter(Boolean).map(statement=>db.prepare(statement)));
 return{mf,db,vault:new D1ProviderCredentialVault(db,options.resolveKey??providerCredentialVaultV1KeyResolver(keyA),options.activeVersion??1,options.generateId)};
}

test('create uses opaque random IDs and persists only independently randomized ciphertext',async t=>{
 const{mf,db,vault}=await fixture();t.after(()=>mf.dispose());
 const first=await vault.create(credential),second=await vault.create(credential);
 assert.ok(isProviderCredentialVaultSecretId(first));assert.ok(isProviderCredentialVaultSecretId(second));assert.notEqual(first,second);
 const rows=(await db.prepare('SELECT * FROM provider_credential_vault ORDER BY secret_id').all()).results;
 assert.equal(rows.length,2);assert.notEqual(rows[0].credential_iv,rows[1].credential_iv);assert.notEqual(rows[0].encrypted_credential,rows[1].encrypted_credential);
 assert.doesNotMatch(JSON.stringify(rows),new RegExp(credential));assert.equal(await vault.resolve(first),credential);assert.equal(await vault.resolve(second),credential);
});

test('ciphertext is identity-bound and tampering, wrong keys, and unsupported versions fail closed',async()=>{
 const first=generateProviderCredentialVaultSecretId(),second=generateProviderCredentialVaultSecretId(),resolveA=providerCredentialVaultV1KeyResolver(keyA);
 const envelope=await encryptVaultCredential(credential,first,resolveA);
 assert.equal(await decryptVaultCredential(envelope,first,resolveA),credential);
 await assert.rejects(()=>decryptVaultCredential(envelope,second,resolveA),code('vault_decryption_failed'));
 await assert.rejects(()=>decryptVaultCredential({...envelope,ciphertext:Buffer.from(envelope.ciphertext,'base64').map((x,i)=>i?x:x^1).toString('base64')},first,resolveA),code('vault_decryption_failed'));
 await assert.rejects(()=>decryptVaultCredential({...envelope,iv:Buffer.alloc(12,9).toString('base64')},first,resolveA),code('vault_decryption_failed'));
 await assert.rejects(()=>decryptVaultCredential(envelope,first,providerCredentialVaultV1KeyResolver(keyB)),code('vault_decryption_failed'));
 await assert.rejects(()=>decryptVaultCredential({...envelope,encryptionVersion:2},first,resolveA),code('vault_encryption_version_unsupported'));
 await assert.rejects(()=>decryptVaultCredential({...envelope,masterKeyVersion:2},first,resolveA),code('vault_master_key_unavailable'));
});

test('replace retains identity, rotates ciphertext, and makes only the replacement resolvable',async t=>{
 const{mf,db,vault}=await fixture();t.after(()=>mf.dispose());const id=await vault.create(credential);
 const before=await db.prepare('SELECT * FROM provider_credential_vault WHERE secret_id=?').bind(id).first(),replacement='replacement-vault-credential-93c1';
 await vault.replace(id,replacement);const after=await db.prepare('SELECT * FROM provider_credential_vault WHERE secret_id=?').bind(id).first();
 assert.equal(after.secret_id,id);assert.equal(after.created_at,before.created_at);assert.notEqual(after.credential_iv,before.credential_iv);assert.notEqual(after.encrypted_credential,before.encrypted_credential);assert.equal(await vault.resolve(id),replacement);assert.doesNotMatch(JSON.stringify(after),new RegExp(`${credential}|${replacement}`));
});

test('delete makes a credential unavailable and recover restores only a valid missing identity',async t=>{
 const{mf,vault}=await fixture();t.after(()=>mf.dispose());const id=await vault.create(credential);await vault.delete(id);
 await assert.rejects(()=>vault.resolve(id),code('vault_secret_unavailable'));await vault.recover(id,'recovered-credential');assert.equal(await vault.resolve(id),'recovered-credential');
 await assert.rejects(()=>vault.recover(id,'must-not-overwrite'),code('vault_secret_exists'));assert.equal(await vault.resolve(id),'recovered-credential');
 await assert.rejects(()=>vault.recover('sec_invalid','value'),code('vault_secret_id_invalid'));
});

test('create collision is rejected without overwriting the existing credential',async t=>{
 const id=generateProviderCredentialVaultSecretId(),{mf,vault}=await fixture({generateId:()=>id});t.after(()=>mf.dispose());
 assert.equal(await vault.create(credential),id);await assert.rejects(()=>vault.create('collision-value'),code('vault_secret_exists'));assert.equal(await vault.resolve(id),credential);
});

test('credential bounds, invalid IDs, missing replacements, and unavailable active keys are rejected safely',async t=>{
 const{mf,vault}=await fixture();t.after(()=>mf.dispose());
 await assert.rejects(()=>vault.create(''),code('vault_credential_empty'));await assert.rejects(()=>vault.create('x'.repeat(MAX_PROVIDER_CREDENTIAL_LENGTH+1)),code('vault_credential_too_large'));
 await assert.rejects(()=>vault.resolve('not-a-secret'),code('vault_secret_id_invalid'));await assert.rejects(()=>vault.replace(generateProviderCredentialVaultSecretId(),'value'),code('vault_secret_unavailable'));
 const unavailable=await fixture({activeVersion:2});t.after(()=>unavailable.mf.dispose());await assert.rejects(()=>unavailable.vault.create('value'),code('vault_master_key_unavailable'));
 assert.equal(ProviderCredentialVaultError.prototype instanceof Error,true);assert.equal(ProviderCredentialVaultServiceError.prototype instanceof Error,true);
});

test('0019 upgrades existing vault rows, enforces CAS, and creates expiring OAuth state',async t=>{const{mf,db,vault}=await fixture();t.after(()=>mf.dispose());const existing=await vault.create(credential),migration=await readFile(new URL('../migrations/0019_add_work_iq_oauth_state.sql',import.meta.url),'utf8');await db.batch(migration.split(';').map(value=>value.trim()).filter(Boolean).map(statement=>db.prepare(statement)));assert.equal(await vault.resolve(existing),credential);const resolved=await vault.resolveWithRevision(existing);assert.deepEqual(resolved,{value:credential,revision:1});assert.equal(await vault.replaceIfRevision(existing,1,'cas-new'),true);assert.equal(await vault.replaceIfRevision(existing,1,'stale-overwrite'),false);assert.equal(await vault.resolve(existing),'cas-new');await vault.replace(existing,'ordinary-api-key');assert.equal(await vault.resolve(existing),'ordinary-api-key');const states=new WorkIqOAuthStateStore(db),verifier=await vault.create('verifier');await states.create({state:'opaque',connectionKey:'work',repositoryRevision:'sha',tenantId:'tenant',clientId:'client',sessionId:'session',verifierSecretRef:verifier,expiresAt:100});await assert.rejects(states.lookup('opaque','session',100),/oauth_state_invalid/);assert.equal(await states.cleanup(vault,100),1);await assert.rejects(vault.resolve(verifier),code('vault_secret_unavailable'));assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM work_iq_oauth_states').first()).count,0)});

test('OAuth consumed and denied states clean verifiers boundedly and remain replay resistant',async t=>{const{mf,db,vault}=await fixture();t.after(()=>mf.dispose());const migration=await readFile(new URL('../migrations/0019_add_work_iq_oauth_state.sql',import.meta.url),'utf8');await db.batch(migration.split(';').map(value=>value.trim()).filter(Boolean).map(statement=>db.prepare(statement)));const states=new WorkIqOAuthStateStore(db),first=await vault.create('first-verifier'),second=await vault.create('second-verifier'),now=Date.now();await states.create({state:'consumed',connectionKey:'work',repositoryRevision:'sha',tenantId:'tenant',clientId:'client',sessionId:'session',verifierSecretRef:first,expiresAt:now+2000000});await states.consume('consumed','session',now);await assert.rejects(states.consume('consumed','session',now+1),/oauth_state_invalid/);assert.equal(await states.cleanup(vault,now+10*60*1000),1);await assert.rejects(vault.resolve(first),code('vault_secret_unavailable'));await states.create({state:'denied',connectionKey:'work',repositoryRevision:'sha',tenantId:'tenant',clientId:'client',sessionId:'session',verifierSecretRef:second,expiresAt:now+2000000});assert.equal((await states.discard('denied','session',vault)).connection_key,'work');await assert.rejects(states.lookup('denied','session'),/oauth_state_invalid/);await assert.rejects(vault.resolve(second),code('vault_secret_unavailable'))});
