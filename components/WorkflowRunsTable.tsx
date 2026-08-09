"use client";

import Link from "next/link";
import {useMemo, useState} from "react";
import {LocalizedTime} from "@/components/LocalizedTime";
import {WorkflowStatusBadge} from "@/components/WorkflowStatusBadge";
import type {RunStatus} from "@/lib/workflow-storage";

export type WorkflowRunTableRow={id:string;workflowName:string;status:RunStatus;createdAt:string;startedAt?:string;completedAt?:string;currentStepId?:string};
type SortKey="workflowName"|"status"|"startedAt"|"completedAt"|"currentStepId";

const columns:readonly {key:SortKey;label:string}[]=[{key:"workflowName",label:"Workflow"},{key:"status",label:"Status"},{key:"startedAt",label:"Started"},{key:"completedAt",label:"Completed"},{key:"currentStepId",label:"Current step"}];
const text=(value:string|undefined)=>value??"";

export function WorkflowRunsTable({runs}:{runs:readonly WorkflowRunTableRow[]}){
 const [sort,setSort]=useState<{key:SortKey;direction:"ascending"|"descending"}>({key:"startedAt",direction:"descending"});
 const sorted=useMemo(()=>runs.map((run,index)=>({run,index})).sort((a,b)=>{
  const value=(item:WorkflowRunTableRow)=>sort.key==="startedAt"?Date.parse(item.startedAt??item.createdAt):sort.key==="completedAt"?(item.completedAt?Date.parse(item.completedAt):-Infinity):text(item[sort.key]).toLocaleLowerCase();
  const av=value(a.run),bv=value(b.run),comparison=typeof av==="number"&&typeof bv==="number"?av-bv:String(av).localeCompare(String(bv));
  return (sort.direction==="ascending"?comparison:-comparison)||(a.index-b.index);
 }),[runs,sort]);
 function changeSort(key:SortKey){setSort(current=>({key,direction:current.key===key&&current.direction==="ascending"?"descending":"ascending"}));}
 return <div className="mt-3 overflow-x-auto rounded-lg border"><table className="w-full min-w-[48rem] border-collapse text-left"><thead className="bg-slate-100 dark:bg-slate-900"><tr>{columns.map(column=>{const direction=sort.key===column.key?sort.direction:"none";return <th key={column.key} scope="col" aria-sort={direction} className="border-b px-3 py-2"><button type="button" onClick={()=>changeSort(column.key)} className="font-bold underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700" aria-label={`Sort by ${column.label}${direction==="none"?"":`, currently ${direction}`}`}>{column.label} {direction==="ascending"?"↑":direction==="descending"?"↓":"↕"}<span className="sr-only">{direction==="none"?", not sorted":`, sorted ${direction}`}</span></button></th>})}</tr></thead><tbody>{sorted.map(({run})=><tr key={run.id} className="border-b last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-900/60"><td className="px-3 py-3 font-semibold"><Link className="underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700" href={`/workflows/runs/${run.id}`}>{run.workflowName}</Link></td><td className="px-3 py-3"><WorkflowStatusBadge status={run.status}/></td><td className="px-3 py-3">{run.startedAt?<LocalizedTime value={run.startedAt}/>:run.status==="queued"?"Not started":<LocalizedTime value={run.createdAt}/>}</td><td className="px-3 py-3">{run.completedAt?<LocalizedTime value={run.completedAt}/>:"—"}</td><td className="px-3 py-3">{run.currentStepId??"—"}</td></tr>)}</tbody></table></div>;
}
