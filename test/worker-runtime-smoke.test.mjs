import test from 'node:test';
import assert from 'node:assert/strict';
import { smokeWorker } from '../scripts/smoke-test-worker.mjs';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

// SIGKILL delivery is asynchronous: observe eventual quiescence, with a strict bound.
async function waitForDescendantTermination(pid, {readStat=()=>readFile(`/proc/${pid}/stat`,'utf8'),timeoutMs=1000,intervalMs=10}={}) {
  const deadline=performance.now()+timeoutMs;
  for (;;) {
    try {
      const stat=await readStat();
      if(stat.slice(stat.lastIndexOf(')')+2).split(' ')[0]==='Z')return;
    } catch(error) {if(error.code==='ENOENT')return;throw error;}
    assert.ok(performance.now()<deadline, 'Descendant remained live after the cleanup settlement deadline');
    await delay(intervalMs);
  }
}

test('descendant settlement accepts transient live states followed by zombie or disappearance',async()=>{
  for(const terminal of ['Z','ENOENT']){
    const states=['R','S',terminal];
    await waitForDescendantTermination(123,{readStat:async()=>{const state=states.shift();if(state==='ENOENT')throw Object.assign(new Error('gone'),{code:'ENOENT'});return `123 (worker child) ${state} 1`}});
    assert.equal(states.length,0);
  }
});
test('descendant settlement fails when a process genuinely remains live past its deadline',async()=>{
  await assert.rejects(waitForDescendantTermination(123,{readStat:async()=>'123 (worker child) R 1',timeoutMs:20,intervalMs:5}),/Descendant remained live/);
});

const fixture = mode => port => [process.execPath, '--input-type=module', '-e', `
  import {createServer} from 'node:http';
  if (${JSON.stringify(mode)} === 'crash') process.exit(7);
  if (${JSON.stringify(mode)} === 'timeout') setInterval(()=>{},1000);
  else createServer((req,res)=>{
    if (${JSON.stringify(mode)} === 'hung-request') return;
    if (${JSON.stringify(mode)} === '500') {console.error('Unexpected loadManifest(/.next/server/preview-props.json) call!');res.writeHead(500);res.end();return;}
    if (${JSON.stringify(mode)} === 'arbitrary') {res.end('ok');return;}
    if (req.url.startsWith('/auth/')) {
      res.writeHead(307, {location:'http://127.0.0.1:${port}/sign-in?error=configuration&returnTo=%2Fsmoke','cache-control':'no-store'});res.end();
    } else {res.writeHead(200, {'content-type':'text/html'});res.end('Sign in required <a href="/auth/github/start">GitHub</a>');}
  }).listen(${port},'127.0.0.1');
`];
test('smoke executes and validates both ADT route contracts', async () => {
  assert.deepEqual(await smokeWorker({command:fixture('ok'),startupMs:5000}), {ok:true});
});
for (const [mode, pattern] of [['500',/HTTP 500/],['arbitrary',/Unexpected ADT response/],['crash',/process stopped/],['timeout',/deadline/],['hung-request',/deadline/]]) {
  test(`smoke rejects ${mode} and cleans up`, async () => {
    await assert.rejects(smokeWorker({command:fixture(mode),startupMs:['timeout','hung-request'].includes(mode)?1000:5000,requestMs:1000}),pattern);
  });
}
test('interruption stops the runtime', async () => {
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(),200);
  try {await assert.rejects(smokeWorker({command:fixture('timeout'),startupMs:5000,signal:controller.signal}),/interrupted/);}
  finally {clearTimeout(timeout);}
});
test('inherited provider credentials never reach the preview process', async () => {
  process.env.GITHUB_APP_CLIENT_SECRET='must-not-reach-worker';
  try {await smokeWorker({command:port=>[process.execPath,'--input-type=module','-e',`
    if(process.env.GITHUB_APP_CLIENT_SECRET) process.exit(99);
    ${fixture('ok')(port)[3]}
  `],startupMs:5000});} finally {delete process.env.GITHUB_APP_CLIENT_SECRET;}
});
test('Wrangler localhost canonicalization is accepted only on the same loopback port', async()=>{
  const {validateProbe}=await import('../scripts/smoke-test-worker.mjs');
  const response=location=>new Response(null,{status:307,headers:{location,'cache-control':'no-store'}});
  const path='/auth/github/start';
  assert.equal(validateProbe(path,response('http://localhost:1234/sign-in?error=configuration&returnTo=%2Fsmoke'),'','http://127.0.0.1:1234'),true);
  for(const origin of ['https://evil.example','http://localhost:9999','http://user:password@localhost:1234'])assert.equal(validateProbe(path,response(`${origin}/sign-in?error=configuration&returnTo=%2Fsmoke`),'','http://127.0.0.1:1234'),false);
});
test('cleanup terminates a stubborn descendant process as well as Wrangler',async()=>{
  const {mkdtemp,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const directory=await mkdtemp(join(tmpdir(),'adt-smoke-child-test-')),pidFile=join(directory,'pid');
  try {
    await smokeWorker({startupMs:5000,command:port=>[process.execPath,'--input-type=module','-e',`
      import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';
      const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});
      await new Promise(resolve=>child.stdout.once('data',resolve));
      writeFileSync(${JSON.stringify(pidFile)},String(child.pid));
      ${fixture('ok')(port)[3]}
    `]});
    const pid=Number(await readFile(pidFile,'utf8'));
    await waitForDescendantTermination(pid);
  } finally {await rm(directory,{recursive:true,force:true});}
});
