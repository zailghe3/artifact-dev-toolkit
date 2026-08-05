import { slugify } from "./artifact-id.ts";
import { normalizeArtifactMetadata } from "./artifact-contract.ts";
import type { Artifact } from "./artifact-repository.ts";
import type { DeletionSnapshot } from "./deletion-ui.ts";
export function normalizeEditorValues(values: string[]) { return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))); }
export type CanonicalEditorSnapshot = { title: string; tags: string[]; aliases: string[]; body: string };
type LiveEditorSnapshot = CanonicalEditorSnapshot & { invalid: boolean };
export function canonicalEditorSnapshot(values: { title: string; tags: string[]; aliases: string[]; body: string }): CanonicalEditorSnapshot {
  const metadata = normalizeArtifactMetadata({ id: "editor", type: "prompt", status: "draft", title: values.title, tags: values.tags, aliases: values.aliases });
  return { title: metadata.title, tags: metadata.tags, aliases: metadata.aliases, body: values.body.trim() };
}
export function liveEditorSnapshot(values: { title: unknown; tags: unknown; aliases: unknown; body: unknown }): LiveEditorSnapshot {
  const title = typeof values.title === "string" ? values.title.trim() : "";
  const tags = Array.isArray(values.tags) && values.tags.every((value) => typeof value === "string") ? normalizeEditorValues(values.tags) : [];
  const aliases = Array.isArray(values.aliases) && values.aliases.every((value) => typeof value === "string") ? normalizeEditorValues(values.aliases) : [];
  const body = typeof values.body === "string" ? values.body.trim() : "";
  return { title, tags, aliases, body, invalid: title.length === 0 || !Array.isArray(values.tags) || !values.tags.every((value) => typeof value === "string") || !Array.isArray(values.aliases) || !values.aliases.every((value) => typeof value === "string") || typeof values.body !== "string" };
}
export function editorValuesAreDirty(current: CanonicalEditorSnapshot, persisted: CanonicalEditorSnapshot) { return JSON.stringify(current) !== JSON.stringify(persisted); }
export function liveEditorValuesAreDirty(current: { title: unknown; tags: unknown; aliases: unknown; body: unknown }, persisted: CanonicalEditorSnapshot) {
  const live = liveEditorSnapshot(current);
  const { invalid, ...canonicalComparable } = live;
  return invalid || editorValuesAreDirty(canonicalComparable, persisted);
}
export function validatedCanonicalEditorSnapshot(value: unknown): CanonicalEditorSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<CanonicalEditorSnapshot>;
  if (typeof candidate.title !== "string" || typeof candidate.body !== "string" || !Array.isArray(candidate.tags) || !candidate.tags.every((item) => typeof item === "string") || !Array.isArray(candidate.aliases) || !candidate.aliases.every((item) => typeof item === "string")) return undefined;
  const canonical = canonicalEditorSnapshot(candidate as CanonicalEditorSnapshot);
  return editorValuesAreDirty(canonical, candidate as CanonicalEditorSnapshot) ? undefined : canonical;
}
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
