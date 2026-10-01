import { createGitHubAppJwt, getRepositoryInstallation, githubHeaders, mintInstallationTokenForRepositoryName, type RepositoryCredential } from "./github-app.ts";
import { getGitHubAppIdentityConfig } from "./repository-authorization.ts";
import type { InfrastructureFreshnessUnknownReason } from "./infrastructure-freshness.ts";
import { deploymentComponentImpact } from "./deployment-component-impact.js";

export type GitHubFreshnessFailureReason = Extract<InfrastructureFreshnessUnknownReason, "github_rate_limited" | "github_access_unavailable" | "comparison_timeout">;
export type CommitComponentImpactEvidence = "relevant" | "irrelevant" | "incomplete";
export const GITHUB_COMMIT_FILES_PER_PAGE = 100;
// Three pages bound enrichment to 300 files per candidate commit. A remaining
// next link produces incomplete evidence rather than a guessed target SHA.
export const GITHUB_COMMIT_FILE_PAGE_LIMIT = 3;
export const GITHUB_COMMIT_FILE_LIMIT = GITHUB_COMMIT_FILES_PER_PAGE * GITHUB_COMMIT_FILE_PAGE_LIMIT;

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
    async commitImpact(component: "worker" | "runtime", sha: string, signal: AbortSignal): Promise<CommitComponentImpactEvidence> {
      for (let page = 1; page <= GITHUB_COMMIT_FILE_PAGE_LIMIT; page++) {
        let response: Response;
        try {
          const sourceCredential = await credential();
          response = await fetchImpl(`https://api.github.com/repos/${source.owner}/${source.repository}/commits/${sha}?per_page=${GITHUB_COMMIT_FILES_PER_PAGE}&page=${page}`, { cache: "no-store", signal, headers: githubHeaders(sourceCredential.token) });
        } catch (error) {
          if (error instanceof GitHubFreshnessEvidenceError) throw error;
          if (signal.aborted) throw new GitHubFreshnessEvidenceError("comparison_timeout");
          throw new GitHubFreshnessEvidenceError("github_access_unavailable");
        }
        if (!response.ok) throw classifiedResponseFailure(response);
        let payload: { files?: unknown };
        try { payload = await response.json() as { files?: unknown }; } catch { return "incomplete"; }
        if (!Array.isArray(payload.files)) return "incomplete";
        const paths: string[] = [];
        for (const raw of payload.files) {
          if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof (raw as { filename?: unknown }).filename !== "string") return "incomplete";
          const file = raw as { filename: string; previous_filename?: unknown };
          paths.push(file.filename);
          if (typeof file.previous_filename === "string" && file.previous_filename) paths.push(file.previous_filename);
        }
        if (deploymentComponentImpact(paths)[component]) return "relevant";
        const hasNextPage = /<[^>]+>;\s*rel="next"/.test(response.headers.get("link") ?? "");
        if (!hasNextPage) return "irrelevant";
      }
      return "incomplete";
    },
  };
}

export function clearGitHubFreshnessCredentialCacheForTests() {
  credentialCache.clear();
  credentialFlights.clear();
}
