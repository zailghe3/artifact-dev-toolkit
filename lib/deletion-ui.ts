import type { Artifact } from "./artifact-repository.ts";
export type DeletionSnapshot = { id: string; title: string; currentFileSha: string };
export type DeletionResult = { kind: "deleted"; artifactId: string; commitUrl: string };
export function deletionConfirmation(snapshot: Pick<DeletionSnapshot, "id" | "title">) { return { heading: `Delete ${snapshot.title} (${snapshot.id})?`, description: "This directly deletes the artifact from the active repository branch. Git history remains available for recovery." }; }
export function deletionRequest(snapshot: DeletionSnapshot) { return { endpoint: `/api/artifacts/${encodeURIComponent(snapshot.id)}`, method: "DELETE" as const, body: { currentFileSha: snapshot.currentFileSha } }; }
export function tombstonesAfterResult(tombstones: ReadonlySet<string>, result: DeletionResult) { return new Set([...tombstones, result.artifactId]); }
export function reconcileTombstones(authoritative: Artifact[], tombstones: ReadonlySet<string>) { const ids = new Set(authoritative.map((artifact) => artifact.id)); return new Set([...tombstones].filter((id) => ids.has(id))); }
export function visibleArtifacts(authoritative: Artifact[], tombstones: ReadonlySet<string>) { return authoritative.filter((artifact) => !tombstones.has(artifact.id)); }
