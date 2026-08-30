import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Connections exposes target-only Git and vault creation',async()=>{
 const [catalogue,newPage,editor]=await Promise.all([
  readFile(new URL('../app/workflows/connections/page.tsx',import.meta.url),'utf8'),
  readFile(new URL('../app/workflows/connections/new/page.tsx',import.meta.url),'utf8'),
  readFile(new URL('../components/ProviderConnectionEditor.tsx',import.meta.url),'utf8'),
 ]);
 assert.match(catalogue,/href:"\/workflows\/connections\/new",label:"New connection"/);
 assert.match(newPage,/ProviderConnectionEditor/);
 assert.match(newPage,/Git-managed connection with a credential stored in the ADT vault/);
 assert.match(editor,/url=editing\?.*:"\/api\/workflow-connections"/s);
 assert.match(editor,/method:editing\?"PUT":"POST"/);
 assert.doesNotMatch(editor,/duplicateSource|\/duplicate|management|cloudflare-binding|source-less|\bd1\b/i);
});
