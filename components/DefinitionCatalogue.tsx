"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useState} from "react";
import type {AgentDefinitionV1,WorkflowDefinition} from "@/lib/workflow-definitions";
import type {Versioned} from "@/lib/workflow-definition-repository";
import {PendingButtonContent} from "@/components/PendingButtonContent";
import {ActionFeedback} from "@/components/ActionFeedback";
import {EntityCard,workflowButton} from "@/components/WorkflowUi";

type Props = {kind:"agent";items:Versioned<AgentDefinitionV1>[]} | {kind:"workflow";items:Versioned<WorkflowDefinition>[]};

export function DefinitionCatalogue({kind,items}:Props) {
 const router=useRouter(),[errors,setErrors]=useState<Record<string,string>>({}),[pendingId,setPendingId]=useState<string>();
 async function remove(item:Versioned<AgentDefinitionV1|WorkflowDefinition>) {
  const id=item.definition.id,noun=kind==="agent"?"agent":"workflow",history=kind==="workflow"?" Historical runs are not deleted.":"";
  if(!confirm(`Delete ${noun} "${item.definition.name}"?\n\nThis removes the ${kind==="workflow"?"Workflow":"Agent"} definition from Git.${history}`)||pendingId)return;
  setPendingId(id);setErrors(current=>({...current,[id]:""}));
  try{
   const endpoint=kind==="agent"?"workflow-agents":"workflow-definitions",response=await fetch(`/api/${endpoint}/${encodeURIComponent(id)}`,{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({fileSha:item.fileSha})});
   if(!response.ok){const body=await response.json() as {code?:string;error?:string};setErrors(current=>({...current,[id]:body.code==="conflict"?"The definition changed since this page was loaded. Refresh and try again.":body.error??"The definition could not be deleted."}));return}
   router.refresh();
  }catch{setErrors(current=>({...current,[id]:"The definition could not be deleted."}))}finally{setPendingId(undefined)}
 }
 return <section className="grid gap-4"><ul className="grid gap-4">{items.map(item=>{const definition=item.definition,feedbackId=`delete-${definition.id}-feedback`;return <li key={definition.id}><EntityCard href={`/workflows/${kind==="agent"?"agents":"definitions"}/${definition.id}`} label={`Open ${kind} ${definition.name}`} actions={<div aria-label={`Actions for ${definition.name}`} className="grid gap-2"><div className="flex gap-2"><Link className={workflowButton.secondary} href={`/workflows/${kind==="agent"?"agents":"definitions"}/${definition.id}/edit`}>Edit</Link><button type="button" aria-label={`Delete ${kind} ${definition.name}`} aria-describedby={feedbackId} className={`${workflowButton.danger} ml-auto`} disabled={Boolean(pendingId)} aria-busy={pendingId===definition.id} onClick={()=>remove(item)}><PendingButtonContent pending={pendingId===definition.id}>{pendingId===definition.id?"Deleting…":"Delete"}</PendingButtonContent></button></div><ActionFeedback id={feedbackId} kind="error" message={errors[definition.id]}/></div>}><h2 className="text-lg font-bold">{definition.name}</h2><p className="mt-2 text-slate-600 dark:text-slate-300">{definition.description||"No description provided."}</p><p className="mt-3 text-sm">{"connectionKey" in definition?<>Connection: <code>{definition.connectionKey}</code></>:<>{definition.nodes.length} {definition.nodes.length===1?"block":"blocks"}</>}</p></EntityCard></li>})}</ul></section>;
}
