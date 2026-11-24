import { base64Url, type RepositoryCredential, createGitHubAppJwt, getRepositoryInstallation, mintInstallationToken, getConfiguredRepository } from "./github-app.ts";
import { authorizeAdtDataContext } from "./adt-data-services.ts";
import { managedContextSchema, repositoryContextSchema, type RepositoryBrokerRequest } from "../adt-runtime/src/runtime-control-contract.ts";
import { type WorkflowRun } from "./workflow-storage.ts";
import { constantTimeEqual } from "./auth-core.ts";

const encoder = new TextEncoder();
async function mac(secret: string, value: string) {
  if (!secret || secret.length < 32) throw new Error("permission_denied");
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function canonicalScope(input: unknown) {
  return repositoryContextSchema.parse(input);
}

export async function signManagedRepositoryAuthorities(run: WorkflowRun, secret: string) {
  if (!Object.keys(run.managedCodeRepositoryContexts ?? {}).length) return undefined;
  const scope = canonicalScope(run.repositoryContext);
  return Object.fromEntries(await Promise.all(Object.entries(run.managedCodeRepositoryContexts!).map(async ([agent, context]) =>
    [agent, await mac(secret, JSON.stringify(["adt-managed-repository-v1", run.id, scope, managedContextSchema.parse(context)]))])));
}

export async function brokerRepositoryCredential(input: RepositoryBrokerRequest, env: Record<string,string>, fetcher: typeof fetch = fetch): Promise<RepositoryCredential> {
  if (input.purpose === "artifacts") return authorizeAdtDataContext(input.context, env, fetcher);
  const { scope, context, runId, authority, capability } = input;
  const expected = await mac(env.SESSION_SECRET, JSON.stringify(["adt-managed-repository-v1", runId, canonicalScope(scope), managedContextSchema.parse(context)]));
  if (!constantTimeEqual(expected, authority)) throw new Error("permission_denied");
  await authorizeAdtDataContext(scope, env, fetcher);
  const config = {owner:context.owner, repo:context.repository};
  const jwt = await createGitHubAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
  const installation = await getRepositoryInstallation(config, jwt, fetcher);
  if (installation.id !== context.installationId) throw new Error("permission_denied");
  const read = await mintInstallationToken(installation.id, context.repositoryId, jwt, "read", fetcher);
  const repository = await getConfiguredRepository(config, read.token, fetcher);
  if (repository.id !== context.repositoryId) throw new Error("permission_denied");
  return mintInstallationToken(installation.id, context.repositoryId, jwt, capability, fetcher);
}
