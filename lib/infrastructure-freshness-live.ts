import "server-only";
import { deploymentMetadata } from "./deployment-metadata.ts";
import { runnerReleaseFreshness } from "./codex-runner-compatibility.ts";
import { getCodexRunnerClient } from "./codex-runner-client.ts";
import { diagnoseADTRuntime } from "./workflow-services.ts";
import {
  collectInfrastructureFreshness,
  type InfrastructureRevisionFreshnessResolver,
} from "./infrastructure-freshness-service.ts";
import {
  infrastructureFreshnessServerTtl,
  INFRASTRUCTURE_FRESHNESS_SERVER_TIMEOUT_MS,
  type InfrastructureFreshnessSnapshot,
} from "./infrastructure-freshness.ts";
import { InfrastructureFreshnessEvidenceCache } from "./infrastructure-freshness-evidence-cache.ts";
import { resolveObservedComponentFreshness } from "./live-component-freshness.ts";
import { createGitHubAppJwt, githubHeaders, mintInstallationToken, type RepositoryCredential } from "./github-app.ts";
import { getGitHubAppIdentityConfig } from "./repository-authorization.ts";
import { deploymentComponentImpact } from "./deployment-component-impact.js";

const SOURCE_REPOSITORY = deploymentMetadata?.repository ?? "zailghe3/artifact-dev-toolkit";
const FULL_SHA = /^[0-9a-f]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GITHUB_EVIDENCE_CACHE_MS = 2 * 60_000;
const MAX_RELEVANT_COMMIT_LOOKUPS = 8;
export type InfrastructureFreshnessRepositoryAuthority = { repositoryId: number; installationId: number; owner: string; repository: string };

let cached: { key: string; expiresAt: number; snapshot: InfrastructureFreshnessSnapshot } | undefined;
let inFlight: { key: string; promise: Promise<InfrastructureFreshnessSnapshot> } | undefined;
let mainRevisionCache: { expiresAt: number; revision: string } | undefined;
let mainRevisionInFlight: Promise<string | undefined> | undefined;
const compareCache = new InfrastructureFreshnessEvidenceCache(GITHUB_EVIDENCE_CACHE_MS);
const commitCache = new InfrastructureFreshnessEvidenceCache(GITHUB_EVIDENCE_CACHE_MS);
const credentialCache = new Map<string, { credential: RepositoryCredential; expiresAt: number }>();

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

async function readCredential(authority: InfrastructureFreshnessRepositoryAuthority): Promise<RepositoryCredential> {
  const key = `${authority.installationId}:${authority.repositoryId}`;
  const cachedCredential = credentialCache.get(key);
  if (cachedCredential && cachedCredential.expiresAt > Date.now()) return cachedCredential.credential;
  const config = getGitHubAppIdentityConfig();
  const credential = await mintInstallationToken(authority.installationId, authority.repositoryId, await createGitHubAppJwt(config.appId, config.privateKey), "read");
  if (credential.permissions.contents !== "read") throw new Error("github_access_unavailable");
  const tokenExpiry = credential.expiresAt ? Date.parse(credential.expiresAt) : Date.now() + 5 * 60_000;
  credentialCache.set(key, { credential, expiresAt: Math.min(tokenExpiry - 60_000, Date.now() + 5 * 60_000) });
  return credential;
}

async function githubJson(url: string, signal: AbortSignal, authority: InfrastructureFreshnessRepositoryAuthority): Promise<unknown> {
  const credential = await readCredential(authority);
  const response = await fetch(url, {
    cache: "no-store",
    signal,
    headers: githubHeaders(credential.token),
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
  authority: InfrastructureFreshnessRepositoryAuthority,
): Promise<unknown | undefined> {
  const key = `${headRevision}:${deployedRevision}`;
  return compareCache.get(key, () => githubJson(
    `https://api.github.com/repos/${repository}/compare/${deployedRevision}...${headRevision}`,
    signal,
    authority,
  ));
}

function resolveMainRevision(signal: AbortSignal, authority: InfrastructureFreshnessRepositoryAuthority): Promise<string | undefined> {
  if (!REPOSITORY.test(SOURCE_REPOSITORY)) return Promise.resolve(undefined);
  if (mainRevisionCache && mainRevisionCache.expiresAt > Date.now()) return Promise.resolve(mainRevisionCache.revision);
  if (!mainRevisionInFlight) {
    mainRevisionInFlight = githubJson(
      `https://api.github.com/repos/${SOURCE_REPOSITORY}/git/ref/heads/main`,
      signal,
      authority,
    ).then((value) => {
      const revision = gitRefRevision(value);
      if (revision) {
        if (mainRevisionCache?.revision !== revision) compareCache.clear();
        mainRevisionCache = { revision, expiresAt: Date.now() + GITHUB_EVIDENCE_CACHE_MS };
      }
      return revision;
    }, () => undefined).finally(() => { mainRevisionInFlight = undefined; });
  }
  return mainRevisionInFlight;
}

async function resolveLiveComponentFreshnessWithSignal(
  component: "worker" | "runtime",
  deployedRevision: string | undefined,
  signal: AbortSignal,
  authority: InfrastructureFreshnessRepositoryAuthority,
) {
  const result = await resolveObservedComponentFreshness(
    component,
    deployedRevision,
    signal,
    currentSignal => resolveMainRevision(currentSignal, authority),
    (revision, headRevision, currentSignal) => comparisonAtHead(SOURCE_REPOSITORY, revision, headRevision, currentSignal, authority),
  );
  if (result.state !== "superseded" || !result.sourceHeadRevision || signal.aborted) return result;
  const comparison = await comparisonAtHead(SOURCE_REPOSITORY, deployedRevision!, result.sourceHeadRevision, signal, authority);
  const commits = comparison && typeof comparison === "object" && Array.isArray((comparison as { commits?: unknown }).commits)
    ? (comparison as { commits: unknown[] }).commits : [];
  if (!commits.length || commits.length > MAX_RELEVANT_COMMIT_LOOKUPS) return result;
  for (const entry of [...commits].reverse()) {
    const sha = entry && typeof entry === "object" && typeof (entry as { sha?: unknown }).sha === "string" ? (entry as { sha: string }).sha.toLowerCase() : undefined;
    if (!sha || !FULL_SHA.test(sha)) return result;
    const detail = await commitCache.get(sha, () => githubJson(`https://api.github.com/repos/${SOURCE_REPOSITORY}/commits/${sha}`, signal, authority));
    const files = detail && typeof detail === "object" && Array.isArray((detail as { files?: unknown }).files) ? (detail as { files: Array<{ filename?: unknown; previous_filename?: unknown }> }).files : undefined;
    if (!files) return result;
    const paths = files.flatMap(file => [file.filename, file.previous_filename]).filter((path): path is string => typeof path === "string" && path.length > 0);
    if (deploymentComponentImpact(paths)[component]) return { ...result, latestRelevantRevision: sha };
  }
  return result;
}

/** Resolves one observed component without probing Runtime, Runner, or other components. */
export async function resolveLiveComponentFreshness(
  component: "worker" | "runtime",
  deployedRevision: string | undefined,
  authority?: InfrastructureFreshnessRepositoryAuthority,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INFRASTRUCTURE_FRESHNESS_SERVER_TIMEOUT_MS);
  try {
    if (!authority) return { state: "unknown" as const, unknownReason: "github_access_unavailable" as const };
    return await aborted(resolveLiveComponentFreshnessWithSignal(component, deployedRevision, controller.signal, authority), controller.signal)
      ?? { state: "unknown" as const, unknownReason: "comparison_timeout" as const };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function collectLiveInfrastructureFreshness(authority: InfrastructureFreshnessRepositoryAuthority): Promise<InfrastructureFreshnessSnapshot> {
  const resolver: InfrastructureRevisionFreshnessResolver = async (component, deployedRevision, signal) => {
    if (component === "runner") return { state: "unknown" };
    return resolveLiveComponentFreshnessWithSignal(component, deployedRevision, signal, authority);
  };
  return collectInfrastructureFreshness({
    workerRevision: deploymentMetadata?.commitSha,
    runtimeRevision,
    runnerFreshness,
    resolveRevisionFreshness: resolver,
    timeoutMs: INFRASTRUCTURE_FRESHNESS_SERVER_TIMEOUT_MS,
  });
}

export async function getInfrastructureFreshnessSnapshot(authority: InfrastructureFreshnessRepositoryAuthority, now = Date.now()): Promise<InfrastructureFreshnessSnapshot> {
  const key = `${authority.installationId}:${authority.repositoryId}`;
  if (cached && cached.key === key && cached.expiresAt > now) return cached.snapshot;
  if (inFlight?.key === key) return inFlight.promise;
  const promise = collectLiveInfrastructureFreshness(authority).then((snapshot) => {
    cached = {
      key,
      snapshot,
      expiresAt: Date.now() + infrastructureFreshnessServerTtl(snapshot),
    };
    return snapshot;
  }).finally(() => { if (inFlight?.promise === promise) inFlight = undefined; });
  inFlight = { key, promise };
  return promise;
}

export function clearInfrastructureFreshnessCacheForTests() {
  cached = undefined;
  inFlight = undefined;
  mainRevisionCache = undefined;
  mainRevisionInFlight = undefined;
  compareCache.clear();
  commitCache.clear();
  credentialCache.clear();
}
