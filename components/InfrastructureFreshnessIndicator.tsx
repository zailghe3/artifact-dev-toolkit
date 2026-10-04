"use client";

import { useEffect, useState } from "react";
import {PendingButtonContent} from "@/components/PendingButtonContent";
import {
  infrastructureFreshnessLabel,
  infrastructureFreshnessClientTtl,
  infrastructureRevisionLabel,
  INFRASTRUCTURE_FRESHNESS_CLIENT_TIMEOUT_MS,
  INFRASTRUCTURE_FRESHNESS_CLIENT_TTL_MS,
  parseInfrastructureFreshnessSnapshot,
  type InfrastructureFreshnessSnapshot,
} from "@/lib/infrastructure-freshness";

export type InfrastructureFreshnessQueryState =
  | { status: "checking" }
  | { status: "hidden" }
  | { status: "loaded"; snapshot: InfrastructureFreshnessSnapshot }
  | { status: "unavailable" };

type CachedValue = { expiresAt: number; snapshot: InfrastructureFreshnessSnapshot };
let memoryCache: CachedValue | undefined;
let inFlight: Promise<InfrastructureFreshnessQueryState> | undefined;

function readMemoryCache(now = Date.now()): CachedValue | undefined {
  if (memoryCache && memoryCache.expiresAt > now) return memoryCache;
  memoryCache = undefined;
  return undefined;
}

function writeMemoryCache(snapshot: InfrastructureFreshnessSnapshot, now = Date.now()) {
  memoryCache = { expiresAt: now + infrastructureFreshnessClientTtl(snapshot), snapshot };
}

export async function queryInfrastructureFreshness(): Promise<InfrastructureFreshnessQueryState> {
  const cached = readMemoryCache();
  if (cached) return { status: "loaded", snapshot: cached.snapshot };
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), INFRASTRUCTURE_FRESHNESS_CLIENT_TIMEOUT_MS);
    try {
      const response = await fetch("/api/infrastructure-freshness", { cache: "no-store", signal: controller.signal });
      if (response.status === 401 || response.status === 403) return { status: "hidden" };
      if (!response.ok) return { status: "unavailable" };
      const snapshot = parseInfrastructureFreshnessSnapshot(await response.json());
      if (!snapshot) return { status: "unavailable" };
      writeMemoryCache(snapshot);
      return { status: "loaded", snapshot };
    } catch {
      return { status: "unavailable" };
    } finally {
      window.clearTimeout(timer);
      inFlight = undefined;
    }
  })();
  return inFlight;
}

function initialIndicatorState(): InfrastructureFreshnessQueryState {
  const cached = readMemoryCache();
  return cached ? { status: "loaded", snapshot: cached.snapshot } : { status: "checking" };
}

function pageVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

export function InfrastructureFreshnessIndicator() {
  const [state, setState] = useState<InfrastructureFreshnessQueryState>(initialIndicatorState);
  const [pending,setPending]=useState<"runtime"|"runner"|null>(null);
  const [feedback,setFeedback]=useState<string>();

  useEffect(() => {
    let active = true;
    let refreshTimer: number | undefined;

    const clearRefreshTimer = () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = undefined;
    };
    const schedule = (delayMs: number) => {
      clearRefreshTimer();
      refreshTimer = window.setTimeout(run, Math.max(0, delayMs));
    };
    const scheduleFromCache = () => {
      const cached = readMemoryCache();
      schedule(cached ? cached.expiresAt - Date.now() : 0);
    };
    const run = () => {
      refreshTimer = undefined;
      if (!active || !pageVisible()) return;
      void queryInfrastructureFreshness().then((next) => {
        if (!active) return;
        setState(next);
        if (next.status === "hidden") return;
        const cached = readMemoryCache();
        schedule(cached ? cached.expiresAt - Date.now() : INFRASTRUCTURE_FRESHNESS_CLIENT_TTL_MS);
      });
    };
    const refreshExpiredOnReturn = () => {
      if (pageVisible() && !readMemoryCache()) schedule(0);
    };

    scheduleFromCache();
    window.addEventListener?.("focus", refreshExpiredOnReturn);
    globalThis.document?.addEventListener?.("visibilitychange", refreshExpiredOnReturn);
    return () => {
      active = false;
      clearRefreshTimer();
      window.removeEventListener?.("focus", refreshExpiredOnReturn);
      globalThis.document?.removeEventListener?.("visibilitychange", refreshExpiredOnReturn);
    };
  }, []);

  async function redeploy(target:"runtime"|"runner"){
    if(pending)return;setPending(target);setFeedback(undefined);
    try{const response=await fetch("/api/infrastructure-redeploy",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({target}),cache:"no-store"}),value=await response.json() as {message?:unknown};setFeedback(typeof value.message==="string"?value.message:"Redeploy request was not accepted.");if(response.status===202){const poll=async(attempt:number)=>{memoryCache=undefined;const next=await queryInfrastructureFreshness();setState(next);if(attempt<12&&next.status==="loaded"&&next.snapshot.components[target].state==="superseded")window.setTimeout(()=>void poll(attempt+1),5_000)};void poll(1)}}catch{setFeedback("Redeploy request outcome is uncertain. Check freshness before trying again.")}finally{setPending(null)}
  }

  if (state.status === "hidden") return null;
  const label = state.status === "checking" ? "Checking infra…" : state.status === "loaded" ? infrastructureFreshnessLabel(state.snapshot) : "Infrastructure freshness unavailable";
  const revisions = state.status === "loaded" ? infrastructureRevisionLabel(state.snapshot) : undefined;
  const tone = state.status === "loaded" && state.snapshot.state === "current"
    ? "text-emerald-700 dark:text-emerald-300"
    : state.status === "loaded" && state.snapshot.state === "superseded"
      ? "text-amber-700 dark:text-amber-300"
      : "text-slate-500 dark:text-slate-400";
  const dot = state.status === "loaded" && state.snapshot.state === "current" ? "●" : state.status === "loaded" && state.snapshot.state === "superseded" ? "●" : "○";

  return (
    <span className={`inline-block min-w-[9rem] ${tone}`} role="status" aria-live="polite">
      <span aria-hidden="true"> · {dot} </span>
      {state.status==="loaded"&&state.snapshot.state==="superseded"?<>
        {state.snapshot.components.worker.state==="superseded"?<span>App update available</span>:null}
        {(["runtime","runner"] as const).map(target=>state.snapshot.components[target].state==="superseded"?<span key={target}><span aria-hidden="true">{state.snapshot.components.worker.state==="superseded"||target==="runner"&&state.snapshot.components.runtime.state==="superseded"?" · ":""}</span><button type="button" disabled={pending!==null} onClick={()=>void redeploy(target)} className="underline-offset-2 hover:text-amber-900 hover:underline disabled:cursor-wait disabled:opacity-70 dark:hover:text-amber-100">{pending===target?<PendingButtonContent pending>{target==="runtime"?"Runtime":"Runner"} update available</PendingButtonContent>:`${target==="runtime"?"Runtime":"Runner"} update available`}</button></span>:null)}
      </>:label}
      {revisions ? <span className="text-slate-500 dark:text-slate-400"> · {revisions}</span> : null}
      {feedback?<span className="block text-slate-600 dark:text-slate-300">{feedback}</span>:null}
    </span>
  );
}
