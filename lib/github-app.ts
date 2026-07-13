const githubApiBaseUrl = "https://api.github.com";

export type GitHubAppConfig = { appId: string; clientId: string; clientSecret: string; privateKey: string; owner: string; repo: string; branch: string; rootPath: string; allowedLogins: string[] };
export type GitHubRepository = { id: number; name: string; owner: { login: string } };
export type GitHubInstallation = { id: number; repository_selection?: string };

export function base64Url(bytes: ArrayBuffer | Uint8Array) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem: string) {
  const base64 = pem.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function createPkceChallenge(verifier: string) {
  return base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

export async function createGitHubAppJwt(appId: string, privateKeyPem: string, now = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey("pkcs8", pemToArrayBuffer(privateKeyPem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId })));
  const input = `${header}.${payload}`;
  const signature = base64Url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input)));
  return `${input}.${signature}`;
}

export function githubHeaders(token?: string) {
  return { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}), "user-agent": "artifact-dev-toolkit", "x-github-api-version": "2022-11-28" };
}

export async function githubJson<T>(fetchImpl: typeof fetch, url: string, init: RequestInit = {}) {
  const response = await fetchImpl(url, init);
  if (!response.ok) throw Object.assign(new Error(`GitHub request failed with ${response.status}`), { status: response.status });
  return response.json() as Promise<T>;
}

export async function getConfiguredRepository(config: Pick<GitHubAppConfig, "owner" | "repo">, token: string, fetchImpl: typeof fetch = fetch) {
  return githubJson<GitHubRepository>(fetchImpl, `${githubApiBaseUrl}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`, { headers: githubHeaders(token) });
}

export async function getRepositoryInstallation(config: Pick<GitHubAppConfig, "owner" | "repo">, appJwt: string, fetchImpl: typeof fetch = fetch) {
  return githubJson<GitHubInstallation>(fetchImpl, `${githubApiBaseUrl}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/installation`, { headers: githubHeaders(appJwt) });
}

export async function mintInstallationToken(installationId: number, repositoryId: number, appJwt: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(`${githubApiBaseUrl}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: { ...githubHeaders(appJwt), "content-type": "application/json" },
    body: JSON.stringify({ repository_ids: [repositoryId], permissions: { contents: "read" } }),
  });
  if (!response.ok) throw Object.assign(new Error(`GitHub installation token request failed with ${response.status}`), { status: response.status });
  const payload = await response.json() as { token?: string; expires_at?: string; permissions?: { contents?: string }; repositories?: { id?: number }[] };
  if (!payload.token) throw new Error("GitHub installation token response was malformed.");
  return payload;
}
