import "server-only";
import { deploymentMetadata } from "./deployment-metadata.ts";
import { resolveComponentFreshnessFromCompare } from "./deployment-freshness-resolution.ts";
import { readCodexRunnerConfiguration } from "./codex-runner-client.ts";
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

async function runnerRevision(signal: AbortSignal): Promise<string | undefined> {
  let configuration;
  try {
    configuration = readCodexRunnerConfiguration();
  } catch {
    return undefined;
  }
  let base: URL;
  try {
    base = new URL(configuration.baseUrl);
  } catch {
    return undefined;
  }
  if (configuration.production && base.protocol !== "https:") return undefined;
  let response: Response;
  try {
    response = await fetch(new URL("/v1/capabilities", base), {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
      signal,
      headers: {
        accept: "application/json",
        "CF-Access-Client-Id": configuration.accessClientId,
        "CF-Access-Client-Secret": configuration.accessClientSecret,
        "X-Codex-Runner-Secret": configuration.sharedSecret,
      },
    });
  } catch {
    return undefined;
  }
  if (!response.ok) return undefined;
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > 8_192) return undefined;
  let text: string;
  try {
    text = await response.text();
  } catch {
    return undefined;
  }
  if (new TextEncoder().encode(text).byteLength > 8_192) return undefined;
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    return typeof value.runnerVersion === "string" && FULL_SHA.test(value.runnerVersion)
      ? value.runnerVersion.toLowerCase()
      : undefined;
  } catch {
    return undefined;
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

async function collectLiveInfrastructureFreshness(): Promise<InfrastructureFreshnessSnapshot> {
  const repository = SOURCE_REPOSITORY;
  const compares = new Map<string, Promise<unknown | undefined>>();
  const resolver: InfrastructureRevisionFreshnessResolver = async (component, deployedRevision, signal) => {
    if (!REPOSITORY.test(repository)) return { state: "unknown" };
    let compare = compares.get(deployedRevision);
    if (!compare) {
      compare = githubJson(
        `https://api.github.com/repos/${repository}/compare/${deployedRevision}...main`,
        signal,
      ).catch(() => undefined);
      compares.set(deployedRevision, compare);
    }
    const value = await compare;
    if (signal.aborted || value === undefined) return { state: "unknown" };
    return resolveComponentFreshnessFromCompare(component, value);
  };
  return collectInfrastructureFreshness({
    workerRevision: deploymentMetadata?.commitSha,
    runtimeRevision,
    runnerRevision,
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
}
