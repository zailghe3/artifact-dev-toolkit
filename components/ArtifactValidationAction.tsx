"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { buttonStyles } from "./Ui";
import { PendingButtonContent } from "./PendingButtonContent";
import { DiagnosticStatusBadge } from "./DiagnosticStatusBadge";
import type { SafeDiagnosticReportInput } from "@/lib/diagnostic-reports";
import { DiagnosticCopyActions } from "./DiagnosticCopyActions";
import { operationalContributors, operationalOverall, withArtifactValidation, type DiagnosticDomain } from "@/lib/operational-diagnostics";
import type { RepositoryDiagnostics } from "@/lib/repository-diagnostics";
import { ARTIFACT_VALIDATION_TIMEOUT_MS, withGitHubDeadline } from "@/lib/github-request";

type Validation = RepositoryDiagnostics["validation"];
const ValidationContext = createContext<{validation: Validation; setValidation: (value: Validation) => void} | null>(null);
const validationSchema = z.object({state:z.enum(["valid","invalid","unavailable"]),revision:z.string().optional(),validCount:z.number().int().nonnegative().optional(),invalidCount:z.number().int().nonnegative().optional(),errors:z.array(z.object({path:z.string(),code:z.string(),message:z.string()})).max(50).optional(),omittedErrorCount:z.number().int().nonnegative().optional()});
export function ArtifactValidationProvider({initial,children}:{initial:Validation;children:React.ReactNode}) {
  const [validation,setValidation] = useState(initial);
  return <ValidationContext.Provider value={{validation,setValidation}}>{children}</ValidationContext.Provider>;
}
function useValidationDomains(domains:DiagnosticDomain[]) { const context=useContext(ValidationContext); return context ? withArtifactValidation(domains,context.validation) : domains; }
export function ArtifactDomainStatus({domain}:{domain:DiagnosticDomain}) {
  const observed=useValidationDomains([domain])[0];
  return <DiagnosticStatusBadge presentation={observed.state === "healthy" ? {label:"Healthy",tone:"positive"} : observed.state === "failed" ? {label:"Needs attention",tone:"negative"} : observed.state === "not-configured" ? {label:"Not configured",tone:"neutral"} : {label:"Degraded",tone:"warning"}} />;
}
export function OperationalHealthSummary({domains}:{domains:DiagnosticDomain[]}) {
  const observed=useValidationDomains(domains), overall=operationalOverall(observed), contributors=operationalContributors(observed);
  return <><div className="flex flex-wrap items-center gap-2"><h2 id="overall-heading" className="text-xl font-black">Overall health</h2><DiagnosticStatusBadge presentation={overall.status}/></div><p className="mt-2 text-sm">{overall.status.description}</p>{contributors.contributors.length ? <div className="mt-4"><h3 className="font-bold">Needs attention</h3><ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{contributors.contributors.map(item=><li key={item.id}><a className="underline underline-offset-2" href={item.href}>{item.message}</a></li>)}</ul>{contributors.omittedCount ? <p className="mt-2 text-sm">And {contributors.omittedCount} more diagnostic checks.</p>:null}</div>:null}</>;
}
export function ArtifactValidationCopyActions({report,domain}:{report:Extract<SafeDiagnosticReportInput,{domain:"artifact-library"}>;domain:DiagnosticDomain}) {
  const context=useContext(ValidationContext), validation=context?.validation;
  const observed=useValidationDomains([domain])[0];
  return <DiagnosticCopyActions report={{...report,state:observed.state,...(validation ? {validation:validation.state,validCount:validation.validCount,invalidCount:validation.invalidCount,validationCodes:validation.errors?.slice(0,20).map(error=>error.code)??[],omittedErrorCount:validation.omittedErrorCount}: {})}}/>;
}
export function ArtifactValidationAction({completed = false}: {completed?: boolean}) {
  const context=useContext(ValidationContext);
  const [local,setLocal]=useState<Validation>({state:"not_run"});
  const validation=context?.validation??local, setValidation=context?.setValidation??setLocal;
  const [pending,setPending]=useState(false), [message,setMessage]=useState("");
  const active=useRef<AbortController|null>(null);
  useEffect(()=>()=>{active.current?.abort();active.current=null;},[]);
  async function run() {
    if(active.current)return;
    const controller=new AbortController(); active.current=controller;setPending(true);setMessage("");
    try {
      const value=await withGitHubDeadline(async signal=>{
        const response=await fetch("/api/diagnostics/repository/validation",{cache:"no-store",signal});
        if(!response.ok)throw new Error("validation_unavailable");
        return z.object({validation:validationSchema}).parse(await response.json()).validation;
      }, ARTIFACT_VALIDATION_TIMEOUT_MS+5_000,controller.signal);
      if(active.current===controller) {setValidation(value);if(value.state==="unavailable")setMessage("Repository validation is temporarily unavailable. Try again.");}
    } catch {
      if(active.current===controller){setValidation({state:"unavailable"});setMessage("Repository validation is temporarily unavailable. Try again.");}
    } finally {
      if(active.current===controller){active.current=null;setPending(false);}
    }
  }
  return <section className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"><h3 className="font-black">Active repository diagnostic</h3><p className="mt-2 text-sm">Validation reads and validates the current repository snapshot only when requested. Its result updates Artifact Library and overall health.</p><button type="button" className={`${buttonStyles.secondary} mt-3`} disabled={pending} aria-busy={pending} onClick={run}><PendingButtonContent pending={pending}>{pending?"Validating…":completed||validation.state!=="not_run"?"Validate artifacts again":"Validate artifacts"}</PendingButtonContent></button><div role="status" aria-live="polite">{message?<p className="mt-3 text-sm">{message}</p>:null}{validation.state!=="not_run"?<div id="artifact-validation" className="mt-3 text-sm"><p>Validation: {validation.state}</p><p>Valid: {validation.validCount??"unknown"} · Invalid: {validation.invalidCount??"unknown"}</p>{validation.errors?.map((error,index)=><p key={index}><code>{error.path}</code>: {error.message}</p>)}{validation.omittedErrorCount?<p>{validation.omittedErrorCount} additional validation errors omitted.</p>:null}</div>:null}</div></section>;
}
