"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {buttonStyles} from "@/components/Ui";

export function AdvisorSaveKnowledge({runId,workflowId,revision,output}:{runId:string;workflowId:string;revision:string;output:string}){
 const router=useRouter(),[pending,setPending]=useState(false),[error,setError]=useState("");
 async function save(){
  if(pending)return;setPending(true);setError("");
  try{
   const body=`Unreviewed Advisor analysis. Verify claims and evidence before publication.\n\n${output.slice(0,6000)}${output.length>6000?"\n\n[Analysis excerpt; open the source execution for the complete result.]":""}`;
   const response=await fetch("/api/advisor/knowledge/proposals",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({document:{metadata:{id:`finding-${crypto.randomUUID()}`,title:`Investigation of ${workflowId}`,type:"finding",status:"active",tags:[],workflowIds:[workflowId],runIds:[runId],evidence:[{source:`workflow:${workflowId}`,revision}]},body},expectedSha:null})});
   const value=await response.json() as {id?:string;error?:string};if(!response.ok||!value.id)throw Error(value.error??"The proposal could not be saved.");
   router.push(`/advisor/knowledge?proposal=${value.id}`);
  }catch(error){setError(error instanceof Error?error.message:"The proposal could not be saved.")}finally{setPending(false)}
 }
 return <div className="mt-4"><button type="button" className={buttonStyles.secondary} disabled={pending} aria-busy={pending} onClick={save}>{pending?"Saving proposal…":"Save to knowledge"}</button><p className="mt-1 text-sm">Creates an editable proposal. You review and approve publication separately.</p>{error&&<p role="alert">{error}</p>}</div>;
}
