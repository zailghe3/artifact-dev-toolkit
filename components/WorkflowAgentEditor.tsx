"use client";

import {useReducer, useState} from "react";
import {useRouter} from "next/navigation";
import {definitionIdDraftReducer, DEFINITION_ID_MAX_LENGTH} from "@/lib/definition-id";
import type {ConnectionDescriptor} from "@/lib/workflow-connections";

type Initial={id:string;name:string;description:string;masterPrompt:string;connectionKey:string;adapterOptions?:Record<string,unknown>};

export function WorkflowAgentEditor({initial,fileSha,connections}:{initial?:Initial;fileSha?:string;connections:ConnectionDescriptor[]}) {
 const router=useRouter();
 const [error,setError]=useState("");
 const [key,setKey]=useState(initial?.connectionKey??connections.find(c=>c.enabled)?.key??"");
 const [identity,updateIdentity]=useReducer(definitionIdDraftReducer,{name:initial?.name??"",id:initial?.id??"",idOverridden:Boolean(initial)});
 const selected=connections.find(c=>c.key===key);

 async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setError("");const data=new FormData(event.currentTarget);let adapterOptions:Record<string,unknown>={};
  if(selected?.adapter==="deterministic-test")adapterOptions={mode:String(data.get("mode")),pendingChecks:Number(data.get("pendingChecks")),cancellation:String(data.get("cancellation"))};
  else if(selected?.adapter==="openai-responses"){const effort=String(data.get("reasoningEffort")??""),verbosity=String(data.get("verbosity")??""),maximum=String(data.get("maxOutputTokens")??"");adapterOptions={...(effort?{reasoningEffort:effort}:{}),...(verbosity?{verbosity}:{}),...(maximum?{maxOutputTokens:Number(maximum)}:{})};}else if(selected?.adapter==="codex-cloud")adapterOptions={environmentKey:String(data.get("environmentKey"))};
  const definition={schemaVersion:1,id:String(data.get("id")),name:String(data.get("name")),description:String(data.get("description")),status:"draft",masterPrompt:String(data.get("masterPrompt")),connectionKey:key,adapterOptions};
  const response=await fetch(initial?`/api/workflow-agents/${initial.id}`:"/api/workflow-agents",{method:initial?"PUT":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(initial?{definition,fileSha}:definition)});if(!response.ok){const body=await response.json() as {error?:string};setError(body.error??"Save failed.");return;}router.push(`/workflows/agents/${definition.id}`);router.refresh();}
 const options=initial?.adapterOptions??{};
 return <form onSubmit={submit} className="mt-6 grid gap-4 max-w-2xl">
  <p className="text-sm">* Required</p>
  {error&&<p role="alert" className="text-red-700">{error}</p>}
  <label>Name *<input name="name" required value={identity.name} onChange={e=>updateIdentity({type:"name",value:e.target.value})} className="block w-full rounded border p-2"/></label>
  <label>ID *<input name="id" required readOnly={Boolean(initial)} value={identity.id} onChange={e=>updateIdentity({type:"id",value:e.target.value})} maxLength={DEFINITION_ID_MAX_LENGTH} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" aria-describedby="agent-id-help" className="block w-full rounded border p-2"/></label>
  <p id="agent-id-help" className="text-sm">Permanent identifier used in Git filenames and Workflow references. Use lowercase letters and numbers separated by hyphens, for example: security-review-agent.</p>
  <label>Description (optional)<textarea name="description" defaultValue={initial?.description} className="block w-full rounded border p-2"/></label>
  <label>Master prompt *<textarea name="masterPrompt" required defaultValue={initial?.masterPrompt} aria-describedby="agent-master-prompt-help" className="block min-h-32 w-full rounded border p-2"/></label>
  <p id="agent-master-prompt-help" className="text-sm">Persistent instructions applied whenever this Agent runs.</p>
  <label>Connection *<select name="connectionKey" required value={key} onChange={e=>setKey(e.target.value)} aria-describedby="agent-connection-help" className="block w-full rounded border p-2">{connections.map(c=><option key={c.key} value={c.key} disabled={!c.enabled&&c.key!==initial?.connectionKey}>{c.name}{c.defaultModel?` — ${c.defaultModel}`:""}{c.enabled?"":" (Not configured)"}</option>)}</select></label>
  <p id="agent-connection-help" className="text-sm">Provider connection used when this Agent runs.</p>
  {selected?.adapter==="deterministic-test"&&<fieldset className="grid gap-3 rounded border p-4"><legend>Safe deterministic options</legend><label>Mode<select name="mode" defaultValue={String(options.mode??"immediate")}><option value="immediate">Immediate completion</option><option value="pending">Pending then completion</option><option value="transient_failure">Transient failure</option><option value="terminal_failure">Terminal failure</option><option value="oversized">Oversized output</option></select></label><label>Pending checks<input name="pendingChecks" type="number" min="0" max="20" defaultValue={Number(options.pendingChecks??0)}/></label><label>Cancellation<select name="cancellation" defaultValue={String(options.cancellation??"supported")}><option value="supported">Supported</option><option value="unsupported">Unsupported</option></select></label></fieldset>}
  {selected?.adapter==="openai-responses"&&<fieldset className="grid gap-3 rounded border p-4"><legend>Safe OpenAI Responses options</legend><label>Reasoning effort (optional)<select name="reasoningEffort" defaultValue={String(options.reasoningEffort??"")}><option value="">Provider default</option>{["none","low","medium","high","xhigh","max"].map(v=><option key={v}>{v}</option>)}</select></label><label>Verbosity (optional)<select name="verbosity" defaultValue={String(options.verbosity??"")}><option value="">Provider default</option>{["low","medium","high"].map(v=><option key={v}>{v}</option>)}</select></label><label>Maximum output tokens (optional)<input name="maxOutputTokens" type="number" min="1" max="262144" defaultValue={options.maxOutputTokens===undefined?"":Number(options.maxOutputTokens)}/></label></fieldset>}
  {selected?.adapter==="codex-cloud"&&<fieldset className="grid gap-3 rounded border p-4"><legend>Codex Cloud environment reference</legend><label>Codex environment key *<input name="environmentKey" required maxLength={80} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" defaultValue={String(options.environmentKey??"")} className="block w-full rounded border p-2"/></label><p>Production transport is currently unavailable. Repository and GitHub configuration remain owned by Codex.</p></fieldset>}
  <button disabled={!selected?.enabled} className="rounded bg-sky-700 px-4 py-2 font-bold text-white disabled:opacity-50">Save Agent</button>
 </form>;
}
