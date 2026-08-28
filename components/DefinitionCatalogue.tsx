"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useState} from "react";
import type {AgentDefinitionV1,WorkflowDefinition} from "@/lib/workflow-definitions";
import type {Versioned} from "@/lib/workflow-definition-repository";
import {EntityCard,workflowButton} from "@/components/WorkflowUi";

type Props = {kind:"agent";items:Versioned<AgentDefinitionV1>[]} | {kind:"workflow";items:Versioned<WorkflowDefinition>[]};

export function DefinitionCatalogue({kind,items}:Props) {
  const router=useRouter(),[error,setError]=useState("");
  async function remove(item:Versioned<AgentDefinitionV1|WorkflowDefinition>) {
    const noun=kind==="agent"?"agent":"workflow";
    const history=kind==="workflow"?" Historical runs are not deleted.":"";
    if (!confirm(`Delete ${noun} "${item.definition.name}"?\n\nThis removes the ${kind==="workflow"?"Workflow":"Agent"} definition from Git.${history}`)) return;
    setError("");
    const endpoint=kind==="agent"?"workflow-agents":"workflow-definitions";
    const response=await fetch(`/api/${endpoint}/${encodeURIComponent(item.definition.id)}`,{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({fileSha:item.fileSha})});
    if (!response.ok) {
      const body=await response.json() as {code?:string;error?:string};
      setError(body.code==="conflict"?"The definition changed since this page was loaded. Refresh and try again.":body.error??"The definition could not be deleted.");
      return;
    }
    router.refresh();
  }
  return <section className="grid gap-4">{error&&<p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}<ul className="grid gap-4">{items.map(item=>{const definition=item.definition;return <li key={definition.id}><EntityCard href={`/workflows/${kind==="agent"?"agents":"definitions"}/${definition.id}`} label={`Open ${kind} ${definition.name}`} actions={<><Link className={workflowButton.secondary} href={`/workflows/${kind==="agent"?"agents":"definitions"}/${definition.id}/edit`}>Edit</Link><button type="button" aria-label={`Delete ${kind} ${definition.name}`} className={`${workflowButton.danger} ml-auto`} onClick={()=>remove(item)}>Delete</button></>}><div className="flex items-start justify-between gap-3"><h2 className="text-lg font-bold">{definition.name}</h2><span className="rounded-full border px-2 py-0.5 text-xs font-semibold">{definition.status}</span></div><p className="mt-2 text-slate-600 dark:text-slate-300">{definition.description||"No description provided."}</p><p className="mt-3 text-sm">{"connectionKey" in definition?<>Connection: <code>{definition.connectionKey}</code></>:<>{definition.schemaVersion===1?definition.steps.length:definition.nodes.length} {(definition.schemaVersion===1?definition.steps.length:definition.nodes.length)===1?"Agent":"Agents"}</>}</p></EntityCard></li>})}</ul></section>;
}
