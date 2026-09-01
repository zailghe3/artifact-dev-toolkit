import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';

const worker=`
import {WorkflowEntrypoint} from "cloudflare:workers";
let outerRuntimeBinding;
class RuntimeClient {
 constructor(fetcher) { this.fetcher = fetcher; }
 readiness() { return this.fetcher.fetch("http://runtime/v1/readiness"); }
}
export class RuntimeContextWorkflow extends WorkflowEntrypoint {
 async run(event, step) {
  return step.do("runtime", async () => {
   const client = new RuntimeClient(this.env.RUNTIME);
   const readiness = await client.readiness();
   const captured = await outerRuntimeBinding.fetch("http://runtime/captured-binding-control");
   return {constructedInsideStep:true,status:readiness.status,capturedStatus:captured.status,body:await readiness.text()};
  });
 }
}
export default {async fetch(_request, env) {
 outerRuntimeBinding = env.RUNTIME;
 const instance = await env.RUNTIME_CONTEXT_WORKFLOW.create();
 return Response.json({id:instance.id});
}};
`;

async function completed(instance){for(let attempt=0;attempt<50;attempt++){const status=await instance.status();if(["complete","errored","terminated"].includes(status.status))return status;await new Promise(resolve=>setTimeout(resolve,20))}throw new Error('workflow_timeout')}

test('Miniflare Workflow performs Runtime I/O from a client constructed inside the real step callback',async t=>{const requests=[],mf=new Miniflare({modules:true,script:worker,compatibilityDate:'2026-07-09',serviceBindings:{RUNTIME:async request=>{requests.push(new URL(request.url).pathname);return new Response('ready')}},workflows:{RUNTIME_CONTEXT_WORKFLOW:{name:'runtime-context',className:'RuntimeContextWorkflow'}}});t.after(()=>mf.dispose());const {id}=await (await mf.dispatchFetch('http://control/start')).json(),bindings=await mf.getBindings(),status=await completed(await bindings.RUNTIME_CONTEXT_WORKFLOW.get(id));assert.equal(status.status,'complete');assert.deepEqual(status.output,{constructedInsideStep:true,status:200,capturedStatus:200,body:'ready'});assert.deepEqual(requests,['/v1/readiness','/captured-binding-control'])});
