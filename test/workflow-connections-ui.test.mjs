import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('OpenAI connection UI supports ready, pending, successful, and safe failure states',async()=>{const source=await readFile(new URL('../components/ProviderConnectionForm.tsx',import.meta.url),'utf8');assert.match(source,/"Test connection"/);assert.match(source,/disabled=\{busy\|\|!configured\}/);assert.match(source,/testing\?"Testing…":"Test connection"/);assert.match(source,/Connection successful/);assert.match(source,/Authentication failed\./);assert.match(source,/Connection test could not be completed\./);assert.match(source,/value\.output\.slice\(0,100\)/);assert.doesNotMatch(source,/value\.message|Authorization|ciphertext|credential_iv|stack/)});
test('Codex Cloud remains explicitly transport unavailable without a test action',async()=>{const page=await readFile(new URL('../app/workflows/connections/page.tsx',import.meta.url),'utf8');assert.match(page,/Codex Cloud/);assert.match(page,/Transport unavailable/);assert.equal((page.match(/<ProviderConnectionForm/g)??[]).length,1)});

test('Codex Runner connection reports the advertised job execution capability',async()=>{const source=await readFile(new URL('../components/CodexRunnerConnection.tsx',import.meta.url),'utf8');assert.match(source,/status\.capabilities\.jobExecution\?"Supported":"Not supported by this Runner"/);assert.doesNotMatch(source,/<dd>Not enabled<\/dd>/)});
test('legacy Codex environment UI is explicitly separate from Runner environments',async()=>{const source=await readFile(new URL('../app/workflows/codex-environments/page.tsx',import.meta.url),'utf8');assert.match(source,/do not configure self-hosted Codex Runner Agents/);assert.match(source,/discovered from the Runner/)});
