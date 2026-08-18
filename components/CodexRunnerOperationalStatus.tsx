"use client";

import {useCallback,useEffect,useRef,useState} from "react";
import {LocalizedTime} from "./LocalizedTime";
import {workflowButton} from "./WorkflowUi";
import type {RunnerJobList,RunnerJobSummary} from "@/lib/codex-runner-client";
import type {SafeCodexConnectionStatus} from "@/lib/codex-runner-status";

export type OperationalLoadState=
 | {status:"loading"}
 | {status:"loaded";data:RunnerJobList;confirmedAt:string}
 | {status:"unavailable";previous?:RunnerJobList;confirmedAt?:string};

const activeStates=new Set(["queued","running","cancelling"]);
const labels={queued:"Starting",running:"Running",cancelling:"Cancelling",completed:"Completed",failed:"Failed",cancelled:"Cancelled"} as const;

function JobCard({job,current=false,matching=false}:{job:RunnerJobSummary;current?:boolean;matching?:boolean}){
 return <article className={`rounded-lg border p-4 ${(current||matching)?"border-sky-600 bg-sky-50 dark:border-orange-400 dark:bg-slate-900":""}`}>
  <div className="flex flex-wrap items-center justify-between gap-2"><code className="break-all text-sm">{job.jobId}</code><span className="rounded-full border px-2 py-1 text-sm font-semibold">{labels[job.state]}</span></div>
  {matching&&<p className="mt-2 font-bold">Matches this Workflow attempt</p>}
  <dl className="mt-3 grid grid-cols-1 gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4"><dt>Environment</dt><dd><code>{job.environmentKey}</code></dd><dt>Created</dt><dd><LocalizedTime value={job.createdAt}/></dd><dt>Last updated</dt><dd><LocalizedTime value={job.updatedAt}/></dd>{job.reason&&<><dt>Safe failure reason</dt><dd>{job.reason.replaceAll("_"," ")}</dd></>}</dl>
 </article>
}

export function CodexRunnerOperationalView({state,expectedDigest}:{state:OperationalLoadState;expectedDigest?:string}){
 if(state.status==="loading")return <p role="status" className="mt-6 rounded-lg border p-4">Checking current Runner work…</p>;
 const data=state.status==="loaded"?state.data:state.previous;
 if(!data)return <p role="alert" className="mt-6 rounded border border-red-600 p-3">Runner operational status is unavailable. Current Runner job state is unknown. Do not infer that retry is safe.</p>;
 const stale=state.status==="unavailable",active=data.capacity.activeJobId?data.jobs.find(job=>job.jobId===data.capacity.activeJobId):undefined,recent=data.jobs.filter(job=>!activeStates.has(job.state)),match=expectedDigest?data.jobs.find(job=>job.idempotencyDigest===expectedDigest):undefined;
 return <>
  {stale&&<p role="alert" className="mt-6 rounded border border-amber-600 p-3"><strong>Current Runner state is unknown.</strong> The information below is stale and was last confirmed {state.confirmedAt?<LocalizedTime value={state.confirmedAt}/>:"at an unknown time"}. Do not infer that retry is safe.</p>}
  {expectedDigest&&!match&&<p className="mt-4 rounded border p-3">No matching Runner record was found in the available history. This does not establish that retry is safe.</p>}
  <div aria-label={stale?"Stale Runner operational information":"Current Runner operational information"}>
   <section className="mt-6"><h2 className="text-xl font-bold">Current work</h2><div className="mt-3">{active?<JobCard job={active} current matching={active===match}/>:<p className="rounded-lg border p-4">{stale?"Last confirmed state had no admitted Workflow job.":"Runner is idle. There is no admitted Workflow job."}</p>}</div></section>
   <section className="mt-6"><h2 className="text-xl font-bold">Recent jobs</h2><div className="mt-3 grid gap-3">{recent.length?recent.map(job=><JobCard job={job} matching={job===match} key={job.jobId}/>):<p className="rounded-lg border p-4">{stale?"No terminal jobs were present in the last confirmed history.":"No terminal jobs are available in the current Runner history."}</p>}</div></section>
  </div>
 </>
}

export function CodexRunnerOperationalStatus({connection,expectedDigest}:{connection:SafeCodexConnectionStatus;expectedDigest?:string}){
 const[state,setState]=useState<OperationalLoadState>({status:"loading"}),[pending,setPending]=useState(false),inFlight=useRef(false);
 const refresh=useCallback(async()=>{if(inFlight.current)return;inFlight.current=true;setPending(true);try{const response=await fetch("/api/workflow-connections/codex-runner/jobs",{cache:"no-store"});if(!response.ok)throw new Error();const data=await response.json() as RunnerJobList;setState({status:"loaded",data,confirmedAt:new Date().toISOString()})}catch{setState(current=>({status:"unavailable",...(current.status==="loaded"?{previous:current.data,confirmedAt:current.confirmedAt}:current.status==="unavailable"&&current.previous?{previous:current.previous,confirmedAt:current.confirmedAt}:{})}))}finally{inFlight.current=false;setPending(false)}},[]);
 useEffect(()=>{const timer=setTimeout(()=>void refresh(),0);return()=>clearTimeout(timer)},[refresh]);
 const known=state.status==="loaded"?state.data:state.status==="unavailable"?state.previous:undefined,shouldPoll=known?.capacity.activeJobId!==null&&known?.capacity.activeJobId!==undefined;
 useEffect(()=>{if(!shouldPoll)return;const timer=setInterval(()=>void refresh(),4000);return()=>clearInterval(timer)},[shouldPoll,refresh]);
 return <><div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-3xl font-black">Codex Runner status</h1><p className="mt-1 text-slate-600 dark:text-slate-300">Read-only operational history from persisted Runner job state.</p></div><button className={workflowButton.secondary} onClick={()=>void refresh()} disabled={pending}>{pending?"Refreshing…":"Refresh"}</button></div><div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded border p-3"><span className="font-semibold">Connection readiness</span><span className="rounded-full border px-2 py-1 text-sm font-semibold">{connection.label}</span></div><p className="mt-4 rounded border p-3">Codex Runner executes one Workflow job at a time. Additional submissions while it is busy are rejected as <code>runner_busy</code> and handled by ADT retry policy.</p><CodexRunnerOperationalView state={state} expectedDigest={expectedDigest}/></>
}
