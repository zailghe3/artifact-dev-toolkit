import "server-only";
import { deploymentMetadata } from "./deployment-metadata.ts";
import { runnerReleaseFreshness } from "./codex-runner-compatibility.ts";
import { resolveComponentFreshness } from "./deployment-freshness-resolution.ts";
import { getCodexRunnerClient } from "./codex-runner-client.ts";
import { diagnoseADTRuntime } from "./workflow-services.ts";
import {
  collectInfrastructureFreshness,
  type InfrastructureRevisionFreshnessResolver,
} from "./infrastructure-freshness-service.ts";
import type { InfrastructureFreshnessSnapshot } from "./infrastructure-freshness.ts";
import { INFRASTRUCTURE_FRESHNESS_SERVER_TIMEOUT_MS } from "./infrastructure-freshness.ts";
import { InfrastructureFreshnessEvidenceCache } from "./infrastructure-freshness-evidence-cache.ts";

const SOURCE_REPOSITORY = deploymentMetadata?.repository ?? "zailghe3/artifact-dev-toolkit";
const FULL_SHA = /^[0-9a-f]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SERVER_CACHE_MS = 60_000;
const SERVER_UNKNOWN_CACHE_MS = 15_000;
const GITHUB_EVIDENCE_CACHE_MS = 2 * 60_000;

let cached: { expiresAt: number; snapshot: InfrastructureFreshnessSnapshot } | undefined;
let inFlight: Promise<InfrastructureFreshnessSnapshot> | undefined;
let mainRevisionCache: { expiresAt: number; revision: string } | undefined;
const compareCache = new InfrastructureFreshnessEvidenceCache(GITHUB_EVIDENCE_CACHE_MS);

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

async function runnerFreshness(signal: AbortSignal) {
  try {
    return runnerReleaseFreshness(await getCodexRunnerClient().capabilities(signal));
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

async function comparisonAtHead(
  repository: string,
  deployedRevision: string,
  headRevision: string,
  signal: AbortSignal,
): Promise<unknown | undefined> {
  const key = `${headRevision}:${deployedRevision}`;
  return compareCache.get(key, () => githubJson(
    `https://api.github.com/repos/${repository}/compare/${deployedRevision}...${headRevision}`,
    signal,
  ));
}

async function collectLiveInfrastructureFreshness(): Promise<InfrastructureFreshnessSnapshot> {
  const repository = SOURCE_REPOSITORY;
  let mainRevisionPromise: Promise<string | undefined> | undefined;
  const resolveMainRevision = (signal: AbortSignal) => {
    if (!REPOSITORY.test(repository)) return Promise.resolve(undefined);
    if (mainRevisionCache && mainRevisionCache.expiresAt > Date.now()) {
      return Promise.resolve(mainRevisionCache.revision);
    }
    if (!mainRevisionPromise) {
      mainRevisionPromise = githubJson(
        `https://api.github.com/repos/${repository}/git/ref/heads/main`,
        signal,
      ).then((value) => {
        const revision = gitRefRevision(value);
        if (revision) {
          if (mainRevisionCache?.revision !== revision) compareCache.clear();
          mainRevisionCache = { revision, expiresAt: Date.now() + GITHUB_EVIDENCE_CACHE_MS };
        }
        return revision;
      }, () => undefined);
    }
    return mainRevisionPromise;
  };
  const resolver: InfrastructureRevisionFreshnessResolver = async (component, deployedRevision, signal) => {
    const headRevision = await resolveMainRevision(signal);
    if (signal.aborted || !headRevision) return { state: "unknown" };
    const result = await resolveComponentFreshness(
      component,
      deployedRevision,
      headRevision,
      () => comparisonAtHead(repository, deployedRevision, headRevision, signal),
    );
    return signal.aborted ? { state: "unknown" } : result;
  };
  return collectInfrastructureFreshness({
    workerRevision: deploymentMetadata?.commitSha,
    runtimeRevision,
    runnerFreshness,
    resolveRevisionFreshness: resolver,
    timeoutMs: INFRASTRUCTURE_FRESHNESS_SERVER_TIMEOUT_MS,
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
  mainRevisionCache = undefined;
  compareCache.clear();
}
