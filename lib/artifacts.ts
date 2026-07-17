import { createArtifactRepository, type Artifact, type ArtifactStatus } from "@/lib/artifact-repository";
import type { RepositoryAccessContext } from "@/lib/repository-authorization";

export type { Artifact, ArtifactStatus };
export { slugify } from "@/lib/artifact-repository";

function getRepository(access: RepositoryAccessContext) {
  return createArtifactRepository(access);
}

export async function getArtifacts(access: RepositoryAccessContext): Promise<Artifact[]> {
  return getRepository(access).list();
}

export async function getArtifact(access: RepositoryAccessContext, id: string) {
  return getRepository(access).findById(id);
}

export async function createVariation(access: RepositoryAccessContext, source: Artifact, body: string, title?: string) {
  return getRepository(access).createVariation({ source, body, title });
}
