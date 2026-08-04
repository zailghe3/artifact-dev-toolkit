import { slugify } from "./artifact-id.ts";
import type { Artifact } from "./artifact-repository.ts";
import type { DeletionSnapshot } from "./deletion-ui.ts";
export function normalizeEditorValues(values: string[]) { return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))); }
export function suggestedArtifactId(title: string, manuallyEdited: boolean, currentId: string) { return manuallyEdited ? currentId : slugify(title); }

export type EditorLifecycleState = { activeFileSha?: string; persistedTitle?: string; completedCreation: boolean; deleted: boolean };
export function initialEditorLifecycle(currentFileSha?: string, persistedTitle?: string): EditorLifecycleState { return { activeFileSha: currentFileSha, persistedTitle, completedCreation: false, deleted: false }; }
export function validFileSha(value: unknown): string | undefined { return typeof value === "string" && /^[a-f0-9]{7,64}$/i.test(value) ? value : undefined; }
export function directWriteCompleted(state: EditorLifecycleState, fileSha: unknown, canonicalTitle: unknown, creating: boolean): EditorLifecycleState | undefined {
  const activeFileSha = validFileSha(fileSha);
  return activeFileSha && typeof canonicalTitle === "string" && canonicalTitle.length > 0
    ? { activeFileSha, persistedTitle: canonicalTitle, completedCreation: creating || state.completedCreation, deleted: false }
    : undefined;
}
export function proposalCompleted(state: EditorLifecycleState): EditorLifecycleState { return state; }
export function directDeletionCompleted(state: EditorLifecycleState): EditorLifecycleState { return { ...state, deleted: true }; }
export function editorRequestAllowed(state: EditorLifecycleState, operation: "preview" | "save" | "delete") {
  return !state.deleted && !(state.completedCreation && (operation === "preview" || operation === "save"));
}
export function editorDeletionSnapshot(state: EditorLifecycleState, artifact: Pick<Artifact, "id" | "status">): DeletionSnapshot | undefined {
  return state.activeFileSha && state.persistedTitle
    ? { id: artifact.id, status: artifact.status, title: state.persistedTitle, currentFileSha: state.activeFileSha }
    : undefined;
}
