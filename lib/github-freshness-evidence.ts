import { createGitHubAppJwt, getRepositoryInstallation, githubHeaders, mintInstallationTokenForRepositoryName, type RepositoryCredential } from "./github-app.ts";
import { getGitHubAppIdentityConfig } from "./repository-authorization.ts";
import type { InfrastructureFreshnessUnknownReason } from "./infrastructure-freshness.ts";

export type GitHubFreshnessFailureReason = Extract<InfrastructureFreshnessUnknownReason, "github_rate_limited" | "github_access_unavailable" | "comparison_timeout">;

export class GitHubFreshnessEvidenceError extends Error {
  readonly reason: GitHubFreshnessFailureReason;
  constructor(reason: GitHubFreshnessFailureReason) {
    super("GitHub freshness evidence unavailable");
    this.name = "GitHubFreshnessEvidenceError";
    this.reason = reason;
  }
}

type SourceRepository = { owner: string; repository: string };
type Dependencies = {
  fetch?: typeof fetch;
  identity?: () => { appId: string; privateKey: string };
  now?: () => number;
  createJwt?: typeof createGitHubAppJwt;
  getInstallation?: typeof getRepositoryInstallation;
  mintToken?: typeof mintInstallationTokenForRepositoryName;
};

const credentialCache = new Map<string, { credential: RepositoryCredential; expiresAt: number }>();
const credentialFlights = new Map<string, Promise<RepositoryCredential>>();

export function parseSourceRepository(value: string): SourceRepository | undefined {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(value);
  return match ? { owner: match[1], repository: match[2] } : undefined;
}

function classifiedResponseFailure(response: Response): GitHubFreshnessEvidenceError {
  const remaining = response.headers.get("x-ratelimit-remaining");
  if (response.status === 429 || (response.status === 403 && remaining === "0")) return new GitHubFreshnessEvidenceError("github_rate_limited");
  return new GitHubFreshnessEvidenceError("github_access_unavailable");
}

export function createGitHubFreshnessEvidence(source: SourceRepository, dependencies: Dependencies = {}) {
  const fetchImpl = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  const sourceKey = `${source.owner.toLowerCase()}/${source.repository.toLowerCase()}`;

  async function credential(): Promise<RepositoryCredential> {
    const existingFlight = credentialFlights.get(sourceKey);
    if (existingFlight) return existingFlight;
    const request = (async () => {
      try {
        const identity = (dependencies.identity ?? getGitHubAppIdentityConfig)();
        const appJwt = await (dependencies.createJwt ?? createGitHubAppJwt)(identity.appId, identity.privateKey);
        const installation = await (dependencies.getInstallation ?? getRepositoryInstallation)({ owner: source.owner, repo: source.repository }, appJwt, fetchImpl);
        const cacheKey = `${installation.id}:${sourceKey}`;
        const cached = credentialCache.get(cacheKey);
        if (cached && cached.expiresAt > now()) return cached.credential;
        const minted = await (dependencies.mintToken ?? mintInstallationTokenForRepositoryName)(installation.id, source.repository, appJwt, "read", fetchImpl);
        if (minted.permissions.contents !== "read") throw new GitHubFreshnessEvidenceError("github_access_unavailable");
        const expiresAt = minted.expiresAt ? Date.parse(minted.expiresAt) : now() + 5 * 60_000;
        credentialCache.set(cacheKey, { credential: minted, expiresAt: Math.min(expiresAt - 60_000, now() + 5 * 60_000) });
        return minted;
      } catch (error) {
        if (error instanceof GitHubFreshnessEvidenceError) throw error;
        const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status?: unknown }).status) : undefined;
        if (status === 429) throw new GitHubFreshnessEvidenceError("github_rate_limited");
        throw new GitHubFreshnessEvidenceError("github_access_unavailable");
      }
    })().finally(() => { credentialFlights.delete(sourceKey); });
    credentialFlights.set(sourceKey, request);
    return request;
  }

  return {
    async json(path: string, signal: AbortSignal): Promise<unknown> {
      let response: Response;
      try {
        const sourceCredential = await credential();
        response = await fetchImpl(`https://api.github.com/repos/${source.owner}/${source.repository}${path}`, { cache: "no-store", signal, headers: githubHeaders(sourceCredential.token) });
      } catch (error) {
        if (error instanceof GitHubFreshnessEvidenceError) throw error;
        if (signal.aborted) throw new GitHubFreshnessEvidenceError("comparison_timeout");
        throw new GitHubFreshnessEvidenceError("github_access_unavailable");
      }
      if (!response.ok) throw classifiedResponseFailure(response);
      try { return await response.json(); } catch { throw new GitHubFreshnessEvidenceError("github_access_unavailable"); }
    },
  };
}

export function clearGitHubFreshnessCredentialCacheForTests() {
  credentialCache.clear();
  credentialFlights.clear();
}
