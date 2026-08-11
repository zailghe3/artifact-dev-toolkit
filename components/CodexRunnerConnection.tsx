"use client";
import {useEffect,useState} from "react";
import type {SafeCodexConnectionStatus} from "@/lib/codex-runner-status";
import {codexRunnerFailureFeedback,type CodexRunnerFeedback as Feedback} from "@/lib/codex-runner-feedback";
import {workflowButton} from "./WorkflowUi";

interface Ceremony{loginId:string;verificationUrl:string;userCode:string}
const MAX_ERROR_BYTES=4096;

async function safeFailure(response:Response,operation:"connect"|"refresh"|"logout"):Promise<Feedback>{
 let value:Record<string,unknown>={};
 const length=Number(response.headers.get("content-length")??0);
 if(length<=MAX_ERROR_BYTES){const text=await response.text();if(new Blob([text]).size<=MAX_ERROR_BYTES)try{value=JSON.parse(text) as Record<string,unknown>}catch{/* Generic feedback is safer. */}}
 return codexRunnerFailureFeedback(response.status,value,operation,window.location.origin);
}

export function CodexRunnerConnection({initialStatus}:{initialStatus:SafeCodexConnectionStatus}){
 const[status,setStatus]=useState(initialStatus),[ceremony,setCeremony]=useState<Ceremony>(),[feedback,setFeedback]=useState<Feedback>();
 async function refresh(){try{const response=await fetch("/api/workflow-connections/codex-runner/status",{cache:"no-store"});if(!response.ok){setFeedback(await safeFailure(response,"refresh"));return}const next=await response.json() as SafeCodexConnectionStatus;setStatus(next);setFeedback(undefined);if(next.state==="connected")setCeremony(undefined)}catch{setFeedback({message:"Runner status could not be refreshed."})}}
 useEffect(()=>{if(!ceremony)return;const timer=setInterval(()=>void refresh(),3000);return()=>clearInterval(timer)},[ceremony]);
 async function connect(){try{const response=await fetch("/api/workflow-connections/codex-runner/device",{method:"POST"});if(!response.ok){setFeedback(await safeFailure(response,"connect"));return}setCeremony(await response.json());setFeedback(undefined);setStatus({...status,state:"waiting",label:"Waiting for device authorization"})}catch{setFeedback({message:"Codex Runner is unavailable. Try again."})}}
 async function logout(){try{const response=await fetch("/api/workflow-connections/codex-runner/logout",{method:"POST"});if(!response.ok){setFeedback(await safeFailure(response,"logout"));return}setCeremony(undefined);setFeedback(undefined);await refresh()}catch{setFeedback({message:"ChatGPT could not be disconnected. Try again."})}}
 return <article className="mt-6 rounded-lg border p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-bold">Codex Runner</h2><p className="mt-1">Self-hosted Codex runtime connection</p></div><span className="rounded-full border px-2 py-1 text-sm font-semibold">{status.label}</span></div>{status.capabilities&&<dl className="mt-3 grid grid-cols-[auto_1fr] gap-2 text-sm"><dt>Runner version</dt><dd><code>{status.capabilities.runnerVersion}</code></dd><dt>Protocol</dt><dd>{status.capabilities.protocolVersion}</dd><dt>Coding jobs</dt><dd>Not enabled</dd></dl>}{feedback&&<div role="alert" className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-red-900 dark:bg-red-950 dark:text-red-100"><p>{feedback.message}</p>{feedback.signInUrl&&<a className="mt-2 inline-block underline" href={feedback.signInUrl}>Sign in</a>}</div>}{ceremony&&<div className="mt-4 rounded border p-3"><p>Open <a className="underline" href={ceremony.verificationUrl} target="_blank" rel="noreferrer">{ceremony.verificationUrl}</a> and enter:</p><p className="mt-2 text-2xl font-bold tracking-widest"><code>{ceremony.userCode}</code></p></div>}<div className="mt-4">{status.state==="disconnected"&&<button className={workflowButton.primary} onClick={connect}>Connect ChatGPT</button>}{status.state==="connected"&&<button className={workflowButton.danger} onClick={logout}>Disconnect / Logout</button>}</div></article>
}
