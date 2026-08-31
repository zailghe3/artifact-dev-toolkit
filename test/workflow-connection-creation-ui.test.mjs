import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {duplicateConnectionDraft} from '../lib/provider-connection-presentation.ts';

test('Connections exposes target-only Git and vault creation',async()=>{
 const [page,catalogue,newPage,editor]=await Promise.all([
  readFile(new URL('../app/workflows/connections/page.tsx',import.meta.url),'utf8'),
  readFile(new URL('../components/ConnectionCatalogue.tsx',import.meta.url),'utf8'),
  readFile(new URL('../app/workflows/connections/new/page.tsx',import.meta.url),'utf8'),
  readFile(new URL('../components/ProviderConnectionEditor.tsx',import.meta.url),'utf8'),
 ]);
 assert.match(page,/href:"\/workflows\/connections\/new",label:"New connection"/);
 assert.match(newPage,/ProviderConnectionEditor/);
 assert.match(newPage,/Git-managed connection with a credential stored in the ADT vault/);
 assert.match(editor,/url=editing\?.*:"\/api\/workflow-connections"/s);
 assert.match(editor,/method:editing\?"PUT":"POST"/);
 assert.match(catalogue,/>Duplicate</);
 assert.doesNotMatch(catalogue,/VaultCredentialControl|Test connection|ADTRuntimeDiagnosticButton/);
 assert.match(editor,/VaultCredentialControl/);
 assert.match(editor,/Test connection/);
 assert.doesNotMatch(editor,/value=\{.*credentialSecretRef|credentialSecretRef.*value=/s);
});

test('duplicate drafts contain only editable non-secret configuration and use a distinct canonical ID',()=>{
 const source={key:'openai-primary',name:'OpenAI Primary',adapter:'openai-agents',defaultModel:'gpt-5',enabled:true,configured:true,credentialSource:'adt-vault',credentialSecretRef:'sec_secret',repositoryRevision:'revision',management:'git',capabilities:{asynchronous:false,cancellation:false}};
 const draft=duplicateConnectionDraft(source,new Set(['openai-primary','openai-primary-copy']));
 assert.deepEqual(draft,{key:'openai-primary-copy-2',name:'OpenAI Primary copy',runtime:'openai-agents',model:'gpt-5'});
 assert.match(draft.key,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
 assert.doesNotMatch(JSON.stringify(draft),/sec_secret|revision|configured|credentialSource/);
 assert.equal(source.key,'openai-primary');
});

test('legacy Codex Cloud environment management page and navigation are retired',async()=>{
 await assert.rejects(access(new URL('../app/workflows/codex-environments/page.tsx',import.meta.url)));
 const navigation=await readFile(new URL('../lib/workflow-navigation.ts',import.meta.url),'utf8');
 assert.doesNotMatch(navigation,/Codex environments|codex-environments/);
});
