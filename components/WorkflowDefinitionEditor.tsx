"use client";

import {useReducer, useState} from "react";
import {useRouter} from "next/navigation";
import {definitionIdDraftReducer, DEFINITION_ID_MAX_LENGTH} from "@/lib/definition-id";

type Agent={id:string;name:string};type Initial={id:string;name:string;description:string;steps:Array<{agentId:string}>};
export function WorkflowDefinitionEditor({agents,initial,fileSha}:{agents:Agent[];initial?:Initial;fileSha?:string}) {
 const router=useRouter(),[steps,setSteps]=useState<string[]>(initial?.steps.map(s=>s.agentId)??[agents[0]?.id??""]),[error,setError]=useState("");
 const [identity,updateIdentity]=useReducer(definitionIdDraftReducer,{name:initial?.name??"",id:initial?.id??"",idOverridden:Boolean(initial)});
 const move=(i:number,d:number)=>setSteps(old=>{const copy=[...old],[item]=copy.splice(i,1);copy.splice(i+d,0,item);return copy});
 async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget),definition={schemaVersion:1,id:String(data.get("id")),name:String(data.get("name")),description:String(data.get("description")),status:"draft",steps:steps.map((agentId,index)=>({id:`step-${index+1}`,name:agents.find(a=>a.id===agentId)?.name??`Step ${index+1}`,agentId,input:{source:index?"previous_step":"run_input"},onSuccess:{type:index===steps.length-1?"complete":"next"},onFailure:{type:"fail"}})),result:{source:"step_output",stepId:`step-${steps.length}`},limits:{maxStepExecutions:Math.max(steps.length,32)}};const response=await fetch(initial?`/api/workflow-definitions/${initial.id}`:"/api/workflow-definitions",{method:initial?"PUT":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(initial?{definition,fileSha}:definition)});if(!response.ok){setError(((await response.json()) as {error?:string}).error??"Save failed.");return;}router.push(`/workflows/definitions/${definition.id}`);router.refresh();}
 return <form onSubmit={submit} className="mt-6 grid max-w-2xl gap-4">
  <p className="text-sm">* Required</p>
  {error&&<p role="alert">{error}</p>}
  <label>Name *<input name="name" required value={identity.name} onChange={e=>updateIdentity({type:"name",value:e.target.value})} className="block w-full rounded border p-2"/></label>
  <label>ID *<input name="id" required readOnly={Boolean(initial)} value={identity.id} onChange={e=>updateIdentity({type:"id",value:e.target.value})} maxLength={DEFINITION_ID_MAX_LENGTH} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" aria-describedby="workflow-id-help" className="block w-full rounded border p-2"/></label>
  <p id="workflow-id-help" className="text-sm">Permanent identifier used in the Workflow&apos;s Git filename and run references. Use lowercase letters and numbers separated by hyphens, for example: feature-implementation-workflow.</p>
  <label>Description (optional)<textarea name="description" defaultValue={initial?.description} className="block w-full rounded border p-2"/></label>
  <fieldset aria-describedby="ordered-agents-help">
   <legend className="font-bold">Ordered Agents *</legend>
   <p id="ordered-agents-help" className="text-sm">Choose the Agents to run in order. The first Agent receives the initial request; each later Agent receives the exact output of the previous Agent. At least one Agent is required.</p>
   {steps.map((value,index)=><div className="mt-3 grid gap-2 rounded border p-3" key={index}>
    <strong>Step {index+1}</strong>
    <label>Agent *<select name={`agent-${index}`} required value={value} onChange={e=>setSteps(old=>old.map((v,i)=>i===index?e.target.value:v))} className="block w-full rounded border p-2">{agents.map(agent=><option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
    <p>{index===0?"Receives the initial Workflow request.":`Receives the exact output from Step ${index}.`}</p>
    <div className="flex gap-2"><button type="button" disabled={!index} onClick={()=>move(index,-1)}>Move up</button><button type="button" disabled={index===steps.length-1} onClick={()=>move(index,1)}>Move down</button><button type="button" disabled={steps.length===1} onClick={()=>setSteps(old=>old.filter((_,i)=>i!==index))}>Remove</button></div>
   </div>)}
   <button type="button" className="mt-3" disabled={!agents.length} onClick={()=>setSteps(old=>[...old,agents[0].id])}>Add step</button>
  </fieldset>
  <p>The final step completes the Workflow and provides its output as the Workflow result.</p>
  <button className="rounded bg-sky-700 px-4 py-2 font-bold text-white">Save Workflow</button>
 </form>;
}
