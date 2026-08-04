import { slugify } from "./artifact-id.ts";
export function normalizeEditorValues(values: string[]) { return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))); }
export function suggestedArtifactId(title: string, manuallyEdited: boolean, currentId: string) { return manuallyEdited ? currentId : slugify(title); }
