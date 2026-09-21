import "server-only";
import { deploymentMetadata } from "./deployment-metadata.ts";
import { runnerReleaseFreshness } from "./codex-runner-compatibility.ts";
import { resolveComponentFreshnessFromCompare } from "./deployment-freshness-resolution.ts";
import { getCodexRunnerClient } from "./codex-runner-client.ts";
import { diagnoseADTRuntime } from "./workflow-services.ts";
import {
  collectInfrastructureFreshness,
  type InfrastructureRevisionFreshnessResolver,
} from "./infrastructure-freshness-service.ts";
import type { InfrastructureFreshnessSnapshot } from "./infrastructure-freshness.ts";

const SOURCE_REPOSITORY = deploymentMetadata?.repository ?? "zailghe3/artifact-dev-toolkit";
const FULL_SHA = /^[0-9a-f]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SERVER_CACHE_MS = 60_000;
const SERVER_UNKNOWN_CACHE_MS = 15_000;

let cached: { expiresAt: number; snapshot: InfrastructureFreshnessSnapshot } | undefined;
let inFlight: Promise<InfrastructureFreshnessSnapshot> | undefined;
let compareHeadRevision: string | undefined;
const compareCache = new Map<string, Promise<unknown | undefined>>();

function aborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  if (signal.aborted) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T | undefined) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => finish(undefined);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(value => finish(value), () => finish(undefined));
  });
}

async function runtimeRevision(signal: AbortSignal): Promise<string | undefined> {
  const diagnostic = await aborted(diagnoseADTRuntime(), signal);
  return diagnostic?.runtimeRevision;
}

async function runnerFreshness(_signal: AbortSignal) {
  try {
    return runnerReleaseFreshness(await getCodexRunnerClient().capabilities());
  } catch {
    return { state: "unknown" as const };
  }
}

async function githubJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    cache: "no-store",
    signal,
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "artifact-dev-toolkit",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error("github_unavailable");
  return response.json();
}

function gitRefRevision(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const object = (value as Record<string, unknown>).object;
  if (!object || typeof object !== "object" || Array.isArray(object)) return undefined;
  const sha = (object as Record<string, unknown>).sha;
  return typeof sha === "string" && FULL_SHA.test(sha) ? sha.toLowerCase() : undefined;
}

function comparisonAtHead(
  repository: string,
  deployedRevision: string,
  headRevision: string,
  signal: AbortSignal,
): Promise<unknown | undefined> {
  if (compareHeadRevision !== headRevision) {
    compareHeadRevision = headRevision;
    compareCache.clear();
  }
  let compare = compareCache.get(deployedRevision);
  if (compare) return compare;
  compare = githubJson(
    `https://api.github.com/repos/${repository}/compare/${deployedRevision}...${headRevision}`,
    signal,
  ).catch(() => {
    compareCache.delete(deployedRevision);
    return undefined;
  });
  compareCache.set(deployedRevision, compare);
  return compare;
}

async function collectLiveInfrastructureFreshness(): Promise<InfrastructureFreshnessSnapshot> {
  const repository = SOURCE_REPOSITORY;
  let mainRevisionPromise: Promise<string | undefined> | undefined;
  const resolveMainRevision = (signal: AbortSignal) => {
    if (!REPOSITORY.test(repository)) return Promise.resolve(undefined);
    if (!mainRevisionPromise) {
      mainRevisionPromise = githubJson(
        `https://api.github.com/repos/${repository}/git/ref/heads/main`,
        signal,
      ).then(gitRefRevision, () => undefined);
    }
    return mainRevisionPromise;
  };
  const resolver: InfrastructureRevisionFreshnessResolver = async (component, deployedRevision, signal) => {
    const headRevision = await resolveMainRevision(signal);
    if (signal.aborted || !headRevision) return { state: "unknown" };
    if (deployedRevision === headRevision) return { state: "current", sourceHeadRevision: headRevision };
    const value = await comparisonAtHead(repository, deployedRevision, headRevision, signal);
    if (signal.aborted || value === undefined) return { state: "unknown" };
    return resolveComponentFreshnessFromCompare(component, value, headRevision);
  };
  return collectInfrastructureFreshness({
    workerRevision: deploymentMetadata?.commitSha,
    runtimeRevision,
    runnerFreshness,
    resolveRevisionFreshness: resolver,
    timeoutMs: 1_500,
  });
}

export async function getInfrastructureFreshnessSnapshot(now = Date.now()): Promise<InfrastructureFreshnessSnapshot> {
  if (cached && cached.expiresAt > now) return cached.snapshot;
  if (inFlight) return inFlight;
  inFlight = collectLiveInfrastructureFreshness().then((snapshot) => {
    cached = {
      snapshot,
      expiresAt: Date.now() + (snapshot.state === "unknown" ? SERVER_UNKNOWN_CACHE_MS : SERVER_CACHE_MS),
    };
    return snapshot;
  }).finally(() => { inFlight = undefined; });
  return inFlight;
}

export function clearInfrastructureFreshnessCacheForTests() {
  cached = undefined;
  inFlight = undefined;
  compareHeadRevision = undefined;
  compareCache.clear();
}
