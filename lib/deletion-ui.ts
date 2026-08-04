import type { Artifact } from "./artifact-repository.ts";
export type DeletionSnapshot = { id: string; title: string; status: Artifact["status"]; currentFileSha: string };
export type DeletionResult = { kind: "deleted"; artifactId: string; commitUrl: string } | { kind: "proposal"; artifactId: string; pullUrl: string };
export function deletionRequest(snapshot: DeletionSnapshot) { const proposal = snapshot.status === "production"; return { endpoint: proposal ? `/api/artifacts/${encodeURIComponent(snapshot.id)}/deletion-proposal` : `/api/artifacts/${encodeURIComponent(snapshot.id)}`, method: proposal ? "POST" as const : "DELETE" as const, body: { currentFileSha: snapshot.currentFileSha } }; }
export function applyDeletionResult(artifacts: Artifact[], result: DeletionResult) { return result.kind === "deleted" ? artifacts.filter((artifact) => artifact.id !== result.artifactId) : artifacts; }
