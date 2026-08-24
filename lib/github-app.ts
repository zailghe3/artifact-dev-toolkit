const githubApiBaseUrl = "https://api.github.com";
import { AuthenticationConfigurationError } from "./auth-configuration.ts";

export type GitHubAppConfig = { appId: string; clientId: string; clientSecret: string; privateKey: string; owner: string; repo: string; branch: string; rootPath: string; allowedLogins: string[] };
export type GitHubRepository = { id: number; name: string; owner: { login: string } };
export type GitHubInstallation = { id: number; repository_selection?: string };
export type RepositoryCredentialCapability = "read" | "write";
export type InstallationCredentialFailure = "authentication_failed" | "installation_missing" | "capability_request_rejected" | "rate_limited" | "temporarily_unavailable" | "malformed_response" | "request_failed";
export class InstallationCredentialError extends Error {
  readonly name = "InstallationCredentialError";
  readonly category: InstallationCredentialFailure;
  readonly capability: RepositoryCredentialCapability;
  readonly status?: number;
  constructor(category: InstallationCredentialFailure, capability: RepositoryCredentialCapability, status?: number) {
    super(`Installation credential request failed: ${category}`);
    this.category = category;
    this.capability = capability;
    this.status = status;
  }
}
export type RepositoryCredential = {
  token: string;
  permissions: { contents?: string; pullRequests?: string };
  expiresAt?: string;
};

export function base64Url(bytes: ArrayBuffer | Uint8Array) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function derLength(length: number) {
  if (length < 128) return Uint8Array.of(length);
  const bytes: number[] = [];
  for (let value = length; value > 0; value >>>= 8) bytes.unshift(value & 255);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function der(tag: number, content: Uint8Array) {
  return Uint8Array.of(tag, ...derLength(content.length), ...content);
}

function pkcs1ToPkcs8(pkcs1: Uint8Array) {
  // rsaEncryption OID + NULL, followed by the PKCS#1 key as an OCTET STRING.
  const algorithm = Uint8Array.of(0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00);
  return der(0x30, Uint8Array.of(0x02, 0x01, 0x00, ...algorithm, ...der(0x04, pkcs1)));
}

function parsePrivateKeyPem(pem: string) {
  const trimmed = pem.trim();
  const match = /^-----BEGIN ([A-Z0-9 ]+)-----\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END \1-----$/.exec(trimmed);
  if (!match || !["PRIVATE KEY", "RSA PRIVATE KEY"].includes(match[1])) throw new AuthenticationConfigurationError("invalid_private_key");
  const payload = match[2].replace(/\s/g, "");
  if (!payload || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) throw new AuthenticationConfigurationError("invalid_private_key");
  try {
    const binary = atob(payload);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (!bytes.length) throw new Error();
    return match[1] === "RSA PRIVATE KEY" ? pkcs1ToPkcs8(bytes) : bytes;
  } catch {
    throw new AuthenticationConfigurationError("invalid_private_key");
  }
}

export async function validateGitHubAppPrivateKey(privateKeyPem: string) {
  try {
    return await crypto.subtle.importKey("pkcs8", parsePrivateKeyPem(privateKeyPem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  } catch (error) {
    if (error instanceof AuthenticationConfigurationError) throw error;
    throw new AuthenticationConfigurationError("invalid_private_key");
  }
}

export async function createPkceChallenge(verifier: string) {
  return base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

export async function createGitHubAppJwt(appId: string, privateKeyPem: string, now = Math.floor(Date.now() / 1000)) {
  const key = await validateGitHubAppPrivateKey(privateKeyPem);
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

export async function mintInstallationToken(installationId: number, repositoryId: number, appJwt: string, capability: RepositoryCredentialCapability, fetchImpl: typeof fetch = fetch): Promise<RepositoryCredential> {
  const permissions = capability === "read" ? { contents: "read" } : { contents: "write" };
  let response: Response;
  try {
    response = await fetchImpl(`${githubApiBaseUrl}/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      headers: { ...githubHeaders(appJwt), "content-type": "application/json" },
      body: JSON.stringify({ repository_ids: [repositoryId], permissions }),
    });
  } catch {
    throw new InstallationCredentialError("temporarily_unavailable", capability);
  }
  if (!response.ok) {
    const category: InstallationCredentialFailure = response.status === 401 ? "authentication_failed"
      : response.status === 403 || response.status === 404 ? "installation_missing"
      : response.status === 422 ? "capability_request_rejected"
      : response.status === 429 ? "rate_limited"
      : response.status >= 500 ? "temporarily_unavailable" : "request_failed";
    throw new InstallationCredentialError(category, capability, response.status);
  }
  let payload: { token?: string; expires_at?: string; permissions?: { contents?: string; pull_requests?: string } };
  try { payload = await response.json() as typeof payload; } catch { throw new InstallationCredentialError("malformed_response", capability, response.status); }
  if (!payload || typeof payload.token !== "string" || !payload.token.trim()) throw new InstallationCredentialError("malformed_response", capability, response.status);
  return {
    token: payload.token,
    permissions: {
      ...(payload.permissions?.contents ? { contents: payload.permissions.contents } : {}),
      ...(payload.permissions?.pull_requests ? { pullRequests: payload.permissions.pull_requests } : {}),
    },
    ...(payload.expires_at ? { expiresAt: payload.expires_at } : {}),
  };
}
