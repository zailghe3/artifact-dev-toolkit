"use client";

import {useCallback,useEffect,useRef,useState} from "react";
import {LocalizedTime} from "./LocalizedTime";
import {workflowButton} from "./WorkflowUi";
import type {RunnerEnvironmentDescriptor,RunnerJobList,RunnerJobSummary,RunnerWorkspaceDiagnostics} from "@/lib/codex-runner-client";
import type {SafeCodexConnectionStatus} from "@/lib/codex-runner-status";
import {EXPECTED_RUNNER_RELEASE} from "@/lib/codex-runner-release";
import {evaluateRunnerCompatibility,shortBuildRevision} from "@/lib/codex-runner-compatibility";

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


type WorkspaceItem={environment:RunnerEnvironmentDescriptor;diagnostics:RunnerWorkspaceDiagnostics|null};
export function WorkspaceSection({items}:{items:WorkspaceItem[]|null}){return <section className="mt-6 rounded-lg border p-4"><h2 className="text-xl font-bold">Workspace</h2>{items===null?<p className="mt-3">Workspace diagnostics require a newer Runner.</p>:<div className="mt-3 grid gap-4">{items.map(({environment,diagnostics})=><article key={environment.key}><h3 className="font-bold">{environment.name}</h3>{diagnostics?<><dl className="grid grid-cols-[auto_1fr] gap-x-4 text-sm"><dt>Filesystem</dt><dd>{diagnostics.filesystemReady?"Ready":"Unavailable"}</dd><dt>Git</dt><dd>{diagnostics.gitAvailable?"Available":"Unavailable"}</dd><dt>Repository</dt><dd>{diagnostics.gitRepository?"Yes":"Not a Git checkout"}</dd><dt>HEAD</dt><dd>{diagnostics.headCommit?<code>{diagnostics.headCommit.slice(0,8)}…</code>:"Unavailable"}</dd><dt>Working tree</dt><dd>{diagnostics.dirty===true?"Modified":diagnostics.dirty===false?"Clean":"State unavailable"}</dd></dl>{!diagnostics.gitAvailable?<p className="mt-2 text-sm">Git is unavailable in this Runner.</p>:!diagnostics.gitRepository?<p className="mt-2 text-sm">The workspace is available but is not currently a Git checkout. Codex can edit files, but repository-aware operations are unavailable.</p>:null}</>:<p className="mt-2 text-sm">Workspace diagnostics require a newer Runner.</p>}</article>)}</div>}</section>}
export function CodexRunnerOperationalStatus({connection,expectedDigest}:{connection:SafeCodexConnectionStatus;expectedDigest?:string}){
 const[state,setState]=useState<OperationalLoadState>({status:"loading"}),[workspaces,setWorkspaces]=useState<WorkspaceItem[]|null>(null),[pending,setPending]=useState(false),inFlight=useRef(false);
 const refresh=useCallback(async()=>{if(inFlight.current)return;inFlight.current=true;setPending(true);try{const response=await fetch("/api/workflow-connections/codex-runner/jobs",{cache:"no-store"});if(!response.ok)throw new Error();const data=await response.json() as RunnerJobList;setState({status:"loaded",data,confirmedAt:new Date().toISOString()})}catch{setState(current=>({status:"unavailable",...(current.status==="loaded"?{previous:current.data,confirmedAt:current.confirmedAt}:current.status==="unavailable"&&current.previous?{previous:current.previous,confirmedAt:current.confirmedAt}:{})}))}finally{inFlight.current=false;setPending(false)}},[]);
 useEffect(()=>{const timer=setTimeout(()=>void refresh(),0);void fetch("/api/workflow-connections/codex-runner/workspaces",{cache:"no-store"}).then(async response=>{if(response.ok){const value=await response.json() as {workspaces:WorkspaceItem[]};setWorkspaces(value.workspaces)}}).catch(()=>{});return()=>clearTimeout(timer)},[refresh]);
 const known=state.status==="loaded"?state.data:state.status==="unavailable"?state.previous:undefined,shouldPoll=known?.capacity.activeJobId!==null&&known?.capacity.activeJobId!==undefined;
 const compatibility=evaluateRunnerCompatibility(connection.capabilities),statusLabel=(value:string)=>value.replaceAll("_"," ").replace(/^./,c=>c.toUpperCase());
 useEffect(()=>{if(!shouldPoll)return;const timer=setInterval(()=>void refresh(),4000);return()=>clearInterval(timer)},[shouldPoll,refresh]);
 return <><div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-3xl font-black">Codex Runner status</h1><p className="mt-1 text-slate-600 dark:text-slate-300">Read-only operational history from persisted Runner job state.</p></div><button className={workflowButton.secondary} onClick={()=>void refresh()} disabled={pending}>{pending?"Refreshing…":"Refresh"}</button></div><div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded border p-3"><span className="font-semibold">Connection readiness</span><span className="rounded-full border px-2 py-1 text-sm font-semibold">{connection.label}</span></div><section className="mt-6 rounded-lg border p-4" aria-label="Compatibility versions"><h2 className="text-xl font-bold">Compatibility</h2>{connection.capabilities?<div className="mt-3 grid gap-4 sm:grid-cols-3"><div><h3 className="font-bold">Protocol</h3><dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm"><dt>Installed</dt><dd>{connection.capabilities.protocolVersion}</dd><dt>Expected</dt><dd>{EXPECTED_RUNNER_RELEASE.protocolVersion}</dd><dt>Status</dt><dd>{statusLabel(compatibility.protocol)}</dd></dl></div><div><h3 className="font-bold">Runner</h3><dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm"><dt>Installed revision</dt><dd>{connection.capabilities.releaseMetadata==="current"?connection.capabilities.runnerRevision:"Unavailable (legacy Runner)"}</dd><dt>Current revision</dt><dd>{EXPECTED_RUNNER_RELEASE.runnerRevision}</dd><dt>Status</dt><dd>{connection.capabilities.releaseMetadata==="legacy"?"Update available":statusLabel(compatibility.runnerRevision)}</dd><dt>Installed build</dt><dd title={connection.capabilities.runnerVersion}><code>{shortBuildRevision(connection.capabilities.runnerVersion)}{connection.capabilities.runnerVersion==="development"?"":"…"}</code></dd></dl>{connection.capabilities.releaseMetadata==="legacy"&&<p className="mt-2 text-sm">Update the Runner to enable revision/version reporting.</p>}</div><div><h3 className="font-bold">Codex</h3><dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm"><dt>Installed CLI</dt><dd>{connection.capabilities.releaseMetadata==="current"?connection.capabilities.codexVersion:"Unavailable"}</dd><dt>Expected CLI</dt><dd>{EXPECTED_RUNNER_RELEASE.codexVersion}</dd><dt>Status</dt><dd>{statusLabel(compatibility.codexVersion)}</dd></dl></div></div>:<p className="mt-3">Compatibility/version status unknown.</p>}</section><WorkspaceSection items={workspaces}/><p className="mt-4 rounded border p-3">Codex Runner executes one Workflow job at a time. Additional submissions while it is busy are rejected as <code>runner_busy</code> and handled by ADT retry policy.</p><CodexRunnerOperationalView state={state} expectedDigest={expectedDigest}/></>
}
