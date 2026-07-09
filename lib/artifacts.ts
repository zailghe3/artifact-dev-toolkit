import { createArtifactRepository, type Artifact, type ArtifactStatus } from "@/lib/artifact-repository";

export type { Artifact, ArtifactStatus };
export { slugify } from "@/lib/artifact-repository";

function getRepository() {
  return createArtifactRepository();
}

export async function getArtifacts(): Promise<Artifact[]> {
  return getRepository().list();
}

export async function getArtifact(id: string) {
  return getRepository().findById(id);
}

export async function createVariation(source: Artifact, body: string, title?: string) {
  return getRepository().createVariation({ source, body, title });
}
