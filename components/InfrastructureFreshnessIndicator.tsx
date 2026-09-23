"use client";

import { useEffect, useState } from "react";
import {
  infrastructureFreshnessLabel,
  infrastructureRevisionLabel,
  INFRASTRUCTURE_FRESHNESS_CLIENT_TIMEOUT_MS,
  parseInfrastructureFreshnessSnapshot,
  type InfrastructureFreshnessSnapshot,
} from "@/lib/infrastructure-freshness";

const CLIENT_TTL_MS = 2 * 60_000;

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
  memoryCache = { expiresAt: now + CLIENT_TTL_MS, snapshot };
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
        schedule(cached ? cached.expiresAt - Date.now() : CLIENT_TTL_MS);
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
      <span aria-hidden="true"> · {dot} </span>{label}
      {revisions ? <span className="text-slate-500 dark:text-slate-400"> · {revisions}</span> : null}
    </span>
  );
}
