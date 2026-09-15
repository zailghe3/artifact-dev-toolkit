"use client";

import { useEffect, useState } from "react";
import {
  infrastructureFreshnessLabel,
  infrastructureRevisionLabel,
  parseInfrastructureFreshnessSnapshot,
  type InfrastructureFreshnessSnapshot,
} from "@/lib/infrastructure-freshness";

const CLIENT_TTL_MS = 2 * 60_000;
const REQUEST_TIMEOUT_MS = 2_000;

type IndicatorState =
  | { status: "checking" }
  | { status: "hidden" }
  | { status: "loaded"; snapshot: InfrastructureFreshnessSnapshot }
  | { status: "unavailable" };

type CachedValue = { expiresAt: number; snapshot: InfrastructureFreshnessSnapshot };
let memoryCache: CachedValue | undefined;
let inFlight: Promise<IndicatorState> | undefined;

function readMemoryCache(now = Date.now()): CachedValue | undefined {
  if (memoryCache && memoryCache.expiresAt > now) return memoryCache;
  memoryCache = undefined;
  return undefined;
}

function writeMemoryCache(snapshot: InfrastructureFreshnessSnapshot, now = Date.now()) {
  memoryCache = { expiresAt: now + CLIENT_TTL_MS, snapshot };
}

async function fetchFreshness(): Promise<IndicatorState> {
  const cached = readMemoryCache();
  if (cached) return { status: "loaded", snapshot: cached.snapshot };
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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

function initialIndicatorState(): IndicatorState {
  const cached = readMemoryCache();
  return cached ? { status: "loaded", snapshot: cached.snapshot } : { status: "checking" };
}

export function InfrastructureFreshnessIndicator() {
  const [state, setState] = useState<IndicatorState>(initialIndicatorState);

  useEffect(() => {
    if (state.status !== "checking") return;
    let active = true;
    const timer = window.setTimeout(() => {
      void fetchFreshness().then((next) => { if (active) setState(next); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [state.status]);

  if (state.status === "hidden") return null;
  const label = state.status === "checking" ? "Checking infra…" : state.status === "loaded" ? infrastructureFreshnessLabel(state.snapshot) : "Infra freshness unavailable";
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
