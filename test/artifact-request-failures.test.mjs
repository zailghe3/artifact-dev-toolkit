import test from 'node:test';
import assert from 'node:assert/strict';
import {GitHubArtifactRepository, ArtifactRepositoryUnavailableError, ArtifactMutationUncertainError} from '../lib/artifact-repository.ts';
import {artifactWriteErrorResponse} from '../lib/artifact-write-http.ts';
import {writeGitHubContents, GitContentWriteError} from '../lib/github-content-write.ts';
import {mintInstallationToken, InstallationCredentialError} from '../lib/github-app.ts';
import {withGitHubDeadline, GitHubRequestTimeoutError} from '../lib/github-request.ts';
import {artifactValidationRequest} from '../lib/artifact-validation-request.ts';

const metadata={id:'new-one',title:'New one',type:'prompt',tags:[],aliases:[]};
const input={metadata,body:'Safe body',actorLogin:'octocat'};
const never=()=>new Promise(()=>{});
const blob='a'.repeat(40);
const tree=()=>Response.json({tree:[{type:'blob',path:'prompts/private-name.md',sha:blob}]});
const content=()=>Response.json({encoding:'base64',content:Buffer.from('---\nid: existing\ntitle: Existing\ntype: prompt\ntags: []\naliases: []\n---\n\nExisting body').toString('base64')});
function repository(overrides={}) {
 const calls=[],logs=[],signals=[],credentials=[];
 const repo=new GitHubArtifactRepository({owner:'private-owner',repo:'private-repo',requestTimeoutMs:5,sleep:async()=>{},
  logger:{info:v=>logs.push(JSON.parse(v)),error:v=>logs.push(JSON.parse(v))},
  credentialProvider:async cap=>{credentials.push(cap);return{token:'hidden-token',permissions:{contents:cap}}},
  fetch:async(url,init)=>{calls.push(String(url));signals.push(init.signal);return String(url).includes('/trees/')?tree():content()}, ...overrides});
 return{repo,calls,logs,signals,credentials};
}
for(const stage of ['tree','blob']) for(const failure of ['timeout','network','body']) test(`${stage} ${failure} is bounded before mutation and logs a safe stage`,async()=>{
 let attempts=0,mutations=0;const signals=[];
 const runtime=repository({fetch:async(url,init)=>{
  if(init.method==='PUT'){mutations++;throw Error('unexpected mutation')}
  if(String(url).includes(stage==='tree'?'/trees/':'/blobs/')) {
   attempts++;signals.push(init.signal);
   if(failure==='network')throw new TypeError('private upstream content');
   if(failure==='body')return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'))}}));
   return never();
  }
  return tree();
 }});
 await assert.rejects(runtime.repo.create(input),ArtifactRepositoryUnavailableError);
 assert.equal(attempts,3);assert.equal(mutations,0);
 if(failure!=='network')assert.ok(signals.every(signal=>signal.aborted));
 const log=runtime.logs.find(l=>l.stage===`preflight_${stage}`&&l.outcome==='failure');
 assert.ok(log);assert.equal(log.mutation,'not_attempted');
 assert.doesNotMatch(JSON.stringify(runtime.logs),/hidden-token|Safe body|private-name|private-owner|private-repo|private upstream/);
});
test('stalled write credential cannot reach the tree or mutation',async()=>{
 const runtime=repository({credentialProvider:never});
 await assert.rejects(runtime.repo.create(input),ArtifactRepositoryUnavailableError);
 assert.equal(runtime.calls.length,0);
 assert.ok(runtime.logs.some(l=>l.stage==='write_credential'&&l.outcome==='failure'&&l.mutation==='not_attempted'));
});
test('cancellation stops retries and queued reads',async()=>{
 const controller=new AbortController();let requests=0;
 const runtime=repository({signal:controller.signal,fetch:async()=>{requests++;controller.abort();return never()}});
 await assert.rejects(runtime.repo.create(input),ArtifactRepositoryUnavailableError);
 assert.equal(requests,1);
});
test('complete validation deadline cancels in-flight blobs and returns no partial report',async()=>{
 const signals=[];const runtime=repository({requestTimeoutMs:1000,validationTimeoutMs:5,fetch:async(url,init)=>{
  if(String(url).includes('/trees/'))return tree();signals.push(init.signal);return never();
 }});
 await assert.rejects(runtime.repo.diagnoseCatalogue('b'.repeat(40)),ArtifactRepositoryUnavailableError);
 assert.equal(signals.length,1);assert.ok(signals[0].aborted);
 assert.ok(runtime.logs.some(l=>l.stage==='diagnostic_validation'&&l.outcome==='failure'));
});
for(const failure of ['transport','timeout','body','malformed'])test(`mutation ${failure} stays uncertain with exactly one PUT`,async()=>{
 let writes=0;
 const runtime=repository({fetch:async(url,init)=>{
  if(init.method==='PUT'){writes++;if(failure==='transport')throw new TypeError('private upstream content');if(failure==='timeout')return never();if(failure==='body')return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'))}}),{status:201});return Response.json({private:'upstream'})}
  return String(url).includes('/trees/')?tree():content();
 }});
 let error;try{await runtime.repo.create(input)}catch(caught){error=caught}
 assert.ok(error instanceof ArtifactMutationUncertainError);assert.equal(writes,1);
 const response=artifactWriteErrorResponse(error),value=await response.json();
 assert.equal(response.status,503);assert.equal(value.code,'mutation_uncertain');assert.match(value.error,/may have saved/);
 assert.ok(runtime.logs.some(l=>l.stage===(['body','malformed'].includes(failure)?'mutation_response':'mutation_put')&&l.outcome==='failure'&&l.mutation==='uncertain'));
 assert.doesNotMatch(JSON.stringify({logs:runtime.logs,value}),/hidden-token|Safe body|private-name|private upstream/);
});
test('redirected mutation never follows the Location or retries',async()=>{
 let writes=0;
 await assert.rejects(writeGitHubContents({url:'https://api.github.com/repos/o/r/contents/a',token:'hidden-token',path:'a',markdown:'Body',message:'Create',branch:'main',fetchImpl:async(_url,init)=>{
  writes++;assert.equal(init.redirect,'manual');return new Response(null,{status:307,headers:{location:'https://other.test'}});
 }}),GitContentWriteError);
 assert.equal(writes,1);
});
test('installation credential network and timeout errors retain safe categories',async t=>{
 await assert.rejects(mintInstallationToken(1,2,'jwt','write',async()=>{throw new TypeError('secret')}),error=>error instanceof InstallationCredentialError&&error.category==='temporarily_unavailable');
 t.mock.timers.enable({apis:['setTimeout']});
 const result=mintInstallationToken(1,2,'jwt','write',never);
 const assertion=assert.rejects(result,error=>error instanceof InstallationCredentialError&&error.category==='temporarily_unavailable');
 await Promise.resolve();t.mock.timers.tick(10_001);await assertion;
});
test('deadline covers response body and respects already cancelled requests',async()=>{
 await assert.rejects(withGitHubDeadline(never,5),GitHubRequestTimeoutError);
 const controller=new AbortController();controller.abort();let calls=0;
 await assert.rejects(withGitHubDeadline(async()=>{calls++},5,controller.signal));assert.equal(calls,0);
});
test('active validation is authenticated, no-store, bounded and independent of unrelated services',async()=>{
 for(const status of [401,403]) {
  let calls=0;const result=await artifactValidationRequest(new Request('https://app.test/validate'),async()=>Response.json({code:'denied'},{status}),async()=>{calls++;return{state:'valid'}});
  assert.equal(result.status,status);assert.equal(calls,0);
 }
 const result=await artifactValidationRequest(new Request('https://app.test/validate'),async()=>({login:'allowed'}),async()=>({state:'valid',validCount:17,invalidCount:0}));
 assert.equal((await result.json()).validation.validCount,17);assert.match(result.headers.get('cache-control'),/no-store/);
 let signal;
 const stalled=await artifactValidationRequest(new Request('https://app.test/validate'),async()=>({}),async(_session,current)=>{signal=current;return never()},5);
 assert.equal(stalled.status,503);assert.ok(signal.aborted);assert.equal((await stalled.json()).validation.state,'unavailable');
});

test('installation credential response-body transport failure is temporary, malformed JSON is invalid',async()=>{
 for(const [response,category] of [[new Response(new ReadableStream({start(controller){controller.error(new TypeError('private upstream'))}})), 'temporarily_unavailable'],[new Response('{bad'), 'malformed_response']]) {
  await assert.rejects(mintInstallationToken(1,2,'jwt','write',async()=>response),error=>error instanceof InstallationCredentialError&&error.category===category);
 }
});
test('ambiguous DELETE is bounded, never retried and returns reconciliation guidance',async()=>{
 let writes=0;
 const runtime=repository({fetch:async(url,init)=>{if(init.method==='DELETE'){writes++;return never()}return String(url).includes('/trees/')?tree():content()}});
 await assert.rejects(runtime.repo.delete({id:'existing',currentFileSha:blob,actorLogin:'octocat'}),ArtifactMutationUncertainError);
 assert.equal(writes,1);
});
