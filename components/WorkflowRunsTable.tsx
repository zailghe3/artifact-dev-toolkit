"use client";

import Link from "next/link";
import {useMemo, useState} from "react";
import {LocalizedTime} from "@/components/LocalizedTime";
import {WorkflowStatusBadge} from "@/components/WorkflowStatusBadge";
import {defaultWorkflowRunSort,nextWorkflowRunSort,sortWorkflowRunRows,workflowRunColumns,type WorkflowRunTableRow,type WorkflowRunSort} from "@/lib/workflow-run-table";
export type {WorkflowRunTableRow};

export function WorkflowRunsTable({runs}:{runs:readonly WorkflowRunTableRow[]}){
 const [sort,setSort]=useState<WorkflowRunSort>(defaultWorkflowRunSort);
 const sorted=useMemo(()=>sortWorkflowRunRows(runs,sort),[runs,sort]);
 return <div className="mt-3 overflow-x-auto rounded-lg border"><table className="w-full min-w-[48rem] border-collapse text-left"><thead className="bg-slate-100 dark:bg-slate-900"><tr>{workflowRunColumns.map(column=>{const direction=sort.key===column.key?sort.direction:"none";return <th key={column.key} scope="col" aria-sort={direction} className="border-b px-3 py-2"><button type="button" onClick={()=>setSort(current=>nextWorkflowRunSort(current,column.key))} className="font-bold underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700" aria-label={`Sort by ${column.label}${direction==="none"?"":`, currently ${direction}`}`}>{column.label} {direction==="ascending"?"↑":direction==="descending"?"↓":"↕"}<span className="sr-only">{direction==="none"?", not sorted":`, sorted ${direction}`}</span></button></th>})}</tr></thead><tbody>{sorted.map(run=><tr key={run.id} className="border-b last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-900/60"><td className="px-3 py-3 font-semibold"><Link className="underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700" href={`/workflows/runs/${run.id}`}>{run.workflowName}</Link></td><td className="px-3 py-3"><WorkflowStatusBadge status={run.status}/></td><td className="px-3 py-3">{run.startedAt?<LocalizedTime value={run.startedAt}/>:run.status==="queued"?"Not started":<LocalizedTime value={run.createdAt}/>}</td><td className="px-3 py-3">{run.completedAt?<LocalizedTime value={run.completedAt}/>:"—"}</td><td className="px-3 py-3">{run.currentStepId??"—"}</td></tr>)}</tbody></table></div>;
}
