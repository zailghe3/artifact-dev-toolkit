import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ArtifactCatalogueService, type ArtifactCatalogueResult, type CatalogueCacheBinding } from "@/lib/artifact-catalogue";
import { createArtifactRepository, getArtifactRepositoryBackend, type Artifact, type ArtifactStatus, type CreateArtifactInput, type UpdateArtifactInput, type ProposeArtifactUpdateInput } from "@/lib/artifact-repository";
import type { RepositoryAccessContext } from "@/lib/repository-authorization";

export type { Artifact, ArtifactStatus, ArtifactCatalogueResult };
export { slugify } from "@/lib/artifact-repository";

let testCache: CatalogueCacheBinding | undefined;
export function setTestCatalogueCache(cache: CatalogueCacheBinding | undefined) { testCache = cache; }

function getRepository(access: RepositoryAccessContext) { return createArtifactRepository(access); }
async function getCache() {
  if (testCache) return testCache;
  const { env } = await getCloudflareContext({ async: true });
  const cache = (env as CloudflareEnv & { ARTIFACT_CATALOGUE_CACHE?: CatalogueCacheBinding }).ARTIFACT_CATALOGUE_CACHE;
  if (!cache) throw new Error("Missing Cloudflare KV binding: ARTIFACT_CATALOGUE_CACHE");
  return cache;
}
async function getService(access: RepositoryAccessContext) {
  const repository = getRepository(access);
  const branch = process.env.GITHUB_ARTIFACT_REPOSITORY_BRANCH ?? "main";
  const root = (process.env.GITHUB_ARTIFACT_REPOSITORY_ROOT ?? "artifacts").replace(/^\/+|\/+$/g, "");
  return new ArtifactCatalogueService({ repository, cache: await getCache(), identity: { repositoryId: access.repositoryId, owner: access.owner, repository: access.repo, branch, root } });
}

export async function getArtifactCatalogue(access: RepositoryAccessContext): Promise<ArtifactCatalogueResult> {
  if (getArtifactRepositoryBackend() === "file") { const artifacts = await getRepository(access).list(); return { artifacts, revision: "local", refreshedAt: new Date().toISOString(), cacheState: "refreshed" }; }
  return (await getService(access)).list();
}
export async function refreshArtifactCatalogue(access: RepositoryAccessContext, full = false) { return (await getService(access)).list({ force: true, full, manual: true }); }
export async function getArtifacts(access: RepositoryAccessContext): Promise<Artifact[]> { return (await getArtifactCatalogue(access)).artifacts; }
export async function getArtifact(access: RepositoryAccessContext, id: string) { return getArtifactRepositoryBackend() === "file" ? getRepository(access).findById(id) : (await getService(access)).findByIdWithRevision(id).then((value) => value?.artifact); }
export async function getArtifactWithRevision(access: RepositoryAccessContext, id: string) { return getArtifactRepositoryBackend() === "file" ? getRepository(access).findByIdWithRevision(id) : (await getService(access)).findByIdWithRevision(id); }
async function invalidate(access: RepositoryAccessContext) { if (getArtifactRepositoryBackend() === "github") await (await getService(access)).invalidate(); }

export async function createVariation(access: RepositoryAccessContext, source: Artifact, body: string, actorLogin: string, title?: string) { const result = await getRepository(access).createVariation({ source, body, title, actorLogin }); await invalidate(access); return result; }
export async function createArtifact(access: RepositoryAccessContext, input: CreateArtifactInput) { const result = await getRepository(access).create(input); await invalidate(access); return result; }
export async function updateArtifact(access: RepositoryAccessContext, input: UpdateArtifactInput) { const result = await getRepository(access).update(input); await invalidate(access); return result; }
export async function proposeArtifactUpdate(access: RepositoryAccessContext, input: ProposeArtifactUpdateInput) { return getRepository(access).proposeUpdate(input); }
