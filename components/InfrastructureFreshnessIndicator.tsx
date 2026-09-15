"use client";

import { useEffect, useState } from "react";
import { infrastructureFreshnessLabel, parseInfrastructureFreshnessSnapshot, type InfrastructureFreshnessSnapshot } from "@/lib/infrastructure-freshness";

const CLIENT_TTL_MS = 2 * 60_000;
const REQUEST_TIMEOUT_MS = 2_000;
const STORAGE_KEY = "adt-infrastructure-freshness-v1";

type IndicatorState =
  | { status: "checking" }
  | { status: "hidden" }
  | { status: "loaded"; snapshot: InfrastructureFreshnessSnapshot }
  | { status: "unavailable" };

type CachedValue = { expiresAt: number; snapshot: InfrastructureFreshnessSnapshot };
let memoryCache: CachedValue | undefined;
let inFlight: Promise<IndicatorState> | undefined;

function readSessionCache(now = Date.now()): CachedValue | undefined {
  if (memoryCache && memoryCache.expiresAt > now) return memoryCache;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as { expiresAt?: unknown; snapshot?: unknown };
    if (!Number.isFinite(value.expiresAt) || Number(value.expiresAt) <= now) return undefined;
    const snapshot = parseInfrastructureFreshnessSnapshot(value.snapshot);
    if (!snapshot) return undefined;
    memoryCache = { expiresAt: Number(value.expiresAt), snapshot };
    return memoryCache;
  } catch {
    return undefined;
  }
}

function writeSessionCache(snapshot: InfrastructureFreshnessSnapshot, now = Date.now()) {
  const value = { expiresAt: now + CLIENT_TTL_MS, snapshot };
  memoryCache = value;
  try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* Cache failure must not affect the footer or app. */ }
}

async function fetchFreshness(): Promise<IndicatorState> {
  const cached = readSessionCache();
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
      writeSessionCache(snapshot);
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

export function InfrastructureFreshnessIndicator() {
  const [state, setState] = useState<IndicatorState>({ status: "checking" });

  useEffect(() => {
    let active = true;
    const cached = readSessionCache();
    if (cached) {
      setState({ status: "loaded", snapshot: cached.snapshot });
      return () => { active = false; };
    }
    const timer = window.setTimeout(() => {
      void fetchFreshness().then((next) => { if (active) setState(next); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, []);

  if (state.status === "hidden") return null;
  const label = state.status === "checking" ? "Checking infra…" : state.status === "loaded" ? infrastructureFreshnessLabel(state.snapshot) : "Infra freshness unavailable";
  const tone = state.status === "loaded" && state.snapshot.state === "current"
    ? "text-emerald-700 dark:text-emerald-300"
    : state.status === "loaded" && state.snapshot.state === "superseded"
      ? "text-amber-700 dark:text-amber-300"
      : "text-slate-500 dark:text-slate-400";
  const dot = state.status === "loaded" && state.snapshot.state === "current" ? "●" : state.status === "loaded" && state.snapshot.state === "superseded" ? "●" : "○";

  return <span className={`inline-block min-w-[9rem] ${tone}`} role="status" aria-live="polite"><span aria-hidden="true">{dot} </span>{label}</span>;
}
