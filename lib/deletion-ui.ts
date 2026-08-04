import type { Artifact } from "./artifact-repository.ts";
export type DeletionSnapshot = { id: string; title: string; status: Artifact["status"]; currentFileSha: string };
export type DeletionResult = { kind: "deleted"; artifactId: string; commitUrl: string } | { kind: "proposal"; artifactId: string; pullUrl: string } | { kind: "recovery"; artifactId: string; branchName: string; branchUrl: string };
export function deletionRequest(snapshot: DeletionSnapshot) { const proposal = snapshot.status === "production"; return { endpoint: proposal ? `/api/artifacts/${encodeURIComponent(snapshot.id)}/deletion-proposal` : `/api/artifacts/${encodeURIComponent(snapshot.id)}`, method: proposal ? "POST" as const : "DELETE" as const, body: { currentFileSha: snapshot.currentFileSha } }; }
export function tombstonesAfterResult(tombstones: ReadonlySet<string>, result: DeletionResult) { const next = new Set(tombstones); if (result.kind === "deleted") next.add(result.artifactId); return next; }
export function reconcileTombstones(authoritative: Artifact[], tombstones: ReadonlySet<string>) { const ids = new Set(authoritative.map((artifact) => artifact.id)); return new Set([...tombstones].filter((id) => ids.has(id))); }
export function visibleArtifacts(authoritative: Artifact[], tombstones: ReadonlySet<string>) { return authoritative.filter((artifact) => !tombstones.has(artifact.id)); }
