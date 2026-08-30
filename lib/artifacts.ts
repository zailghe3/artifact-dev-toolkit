import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ArtifactCatalogueService, CatalogueCacheUnavailableError, type ArtifactCatalogueResult, type CatalogueCacheBinding } from "@/lib/artifact-catalogue";
import { createArtifactRepository, GitHubArtifactRepository, getArtifactRepositoryBackend, type Artifact, type CreateArtifactInput, type UpdateArtifactInput, type DeleteArtifactInput } from "@/lib/artifact-repository";
import type { RepositoryAccessContext } from "@/lib/repository-authorization";
import { completeWriteWithInvalidation } from "@/lib/artifact-cache-invalidation";
import { localArtifactDetail } from "@/lib/catalogue-presentation";
import { collectTagSuggestions } from "@/lib/tag-suggestions";
import {DEFAULT_ARTIFACT_ROOT} from "@/lib/artifact-contract";
export { completeWriteWithInvalidation } from "@/lib/artifact-cache-invalidation";

export type { Artifact, ArtifactCatalogueResult };
export { slugify } from "@/lib/artifact-repository";

let testCache: CatalogueCacheBinding | undefined;
export function setTestCatalogueCache(cache: CatalogueCacheBinding | undefined) { testCache = cache; }

function getRepository(access: RepositoryAccessContext) { return createArtifactRepository(access); }
async function getCache() {
  if (testCache) return testCache;
  const { env } = await getCloudflareContext({ async: true });
  const cache = (env as CloudflareEnv & { ARTIFACT_CATALOGUE_CACHE?: CatalogueCacheBinding }).ARTIFACT_CATALOGUE_CACHE;
  if (!cache) throw new CatalogueCacheUnavailableError();
  return cache;
}
export async function inspectCatalogueCacheBinding(): Promise<"configured" | "missing" | "invalid"> {
  if (testCache) return "configured";
  try {
    const context = await getCloudflareContext({ async: true });
    if (!context || typeof context !== "object" || !("env" in context) || !context.env || typeof context.env !== "object") return "invalid";
    return (context.env as CloudflareEnv & { ARTIFACT_CATALOGUE_CACHE?: unknown }).ARTIFACT_CATALOGUE_CACHE ? "configured" : "missing";
  } catch { return "invalid"; }
}
async function getService(access: RepositoryAccessContext) {
  const repository = getRepository(access);
  const branch = process.env.GITHUB_ARTIFACT_REPOSITORY_BRANCH ?? "main";
  const root = DEFAULT_ARTIFACT_ROOT;
  return new ArtifactCatalogueService({ repository, cache: await getCache(), identity: { repositoryId: access.repositoryId, owner: access.owner, repository: access.repo, branch, root } });
}

export async function getArtifactCatalogue(access: RepositoryAccessContext): Promise<ArtifactCatalogueResult> {
  if (getArtifactRepositoryBackend() === "file") { const artifacts = await getRepository(access).list(); return { artifacts, revision: "local", refreshedAt: new Date().toISOString(), cacheState: "refreshed", cacheEnabled: false }; }
  return { ...await (await getService(access)).list(), cacheEnabled: true };
}
export async function refreshArtifactCatalogue(access: RepositoryAccessContext, full = false) { if (getArtifactRepositoryBackend() === "file") return undefined; return (await getService(access)).list({ force: true, full, manual: true }); }
export async function inspectArtifactCatalogueCache(access: RepositoryAccessContext, revision?: string) { if (getArtifactRepositoryBackend() === "file") return { configured: false as const, state: "missing" as const }; try { return await (await getService(access)).inspect(revision); } catch (error) { if (error instanceof CatalogueCacheUnavailableError) return { configured: false as const, state: "unavailable" as const, reason: "cache_binding_missing" }; throw error; } }
export async function getArtifactRepositoryDiagnostics(access: RepositoryAccessContext, revision?: string) { const repository = getRepository(access); if (!repository.diagnoseCatalogue) return undefined; return repository.diagnoseCatalogue(revision); }
export async function getArtifactBaseRevision(access: RepositoryAccessContext) { return getRepository(access).getBaseRevision(); }
export async function getArtifacts(access: RepositoryAccessContext): Promise<Artifact[]> { return (await getArtifactCatalogue(access)).artifacts; }
export async function getArtifactsForRepositoryContext(access:RepositoryAccessContext,context:{repositoryId:number;owner:string;repository:string;branch:string;root:string},dependencies:{cache?:CatalogueCacheBinding;fetch?:typeof fetch}={}){if(access.repositoryId!==context.repositoryId||access.owner.toLowerCase()!==context.owner.toLowerCase()||access.repo.toLowerCase()!==context.repository.toLowerCase())throw new Error("tool_repository_context_mismatch");const repository=new GitHubArtifactRepository({owner:context.owner,repo:context.repository,branch:context.branch,rootPath:DEFAULT_ARTIFACT_ROOT,credentialProvider:access.installationCredentialProvider,...(dependencies.fetch?{fetch:dependencies.fetch}:{})}),cache=dependencies.cache??await getCache(),service=new ArtifactCatalogueService({repository,cache,identity:{repositoryId:context.repositoryId,owner:context.owner,repository:context.repository,branch:context.branch,root:context.root}});return (await service.list()).artifacts;}
export async function getTagSuggestions(access: RepositoryAccessContext) { return collectTagSuggestions(await getArtifacts(access)); }
export async function getArtifact(access: RepositoryAccessContext, id: string) { return getArtifactRepositoryBackend() === "file" ? getRepository(access).findById(id) : (await getService(access)).findByIdWithRevision(id).then((value) => value?.artifact); }
export async function getArtifactWithRevision(access: RepositoryAccessContext, id: string) {
  if (getArtifactRepositoryBackend() === "file") { const artifact = await getRepository(access).findById(id); return artifact ? localArtifactDetail(artifact, new Date().toISOString()) : undefined; }
  return (await getService(access)).findByIdWithRevision(id);
}
async function invalidate(access: RepositoryAccessContext) {
  if (getArtifactRepositoryBackend() !== "github") return;
  try { await (await getService(access)).invalidate(); }
  catch { console.error(JSON.stringify({ event: "artifact_catalogue_cache_invalidation_failure", repositoryId: access.repositoryId, owner: access.owner, repository: access.repo, category: "cache_unavailable" })); }
}

export async function createVariation(access: RepositoryAccessContext, source: Artifact, body: string, actorLogin: string, title?: string) { const repository = getRepository(access); return completeWriteWithInvalidation(() => repository.createVariation({ source, body, title, actorLogin }), () => invalidate(access), access); }
export async function createArtifact(access: RepositoryAccessContext, input: CreateArtifactInput) { const repository = getRepository(access); return completeWriteWithInvalidation(() => repository.create(input), () => invalidate(access), access); }
export async function updateArtifact(access: RepositoryAccessContext, input: UpdateArtifactInput) { const repository = getRepository(access); return completeWriteWithInvalidation(() => repository.update(input), () => invalidate(access), access); }
export async function deleteArtifact(access: RepositoryAccessContext, input: DeleteArtifactInput) { const repository = getRepository(access); return completeWriteWithInvalidation(() => repository.delete(input), () => invalidate(access), access); }
