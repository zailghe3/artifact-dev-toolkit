export const DEFINITION_ID_MAX_LENGTH = 80;

/** Create a schema-compatible definition ID without changing existing IDs. */
export function definitionIdFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, DEFINITION_ID_MAX_LENGTH)
    .replace(/-+$/g, "");
}

export type DefinitionIdDraft = {name: string; id: string; idOverridden: boolean};
export type DefinitionIdDraftAction = {type: "name" | "id"; value: string};

/** Preserve an explicit keyboard or pointer edit while names continue to change. */
export function definitionIdDraftReducer(state: DefinitionIdDraft, action: DefinitionIdDraftAction): DefinitionIdDraft {
  if (action.type === "id") return {...state, id: action.value, idOverridden: true};
  return {...state, name: action.value, id: state.idOverridden ? state.id : definitionIdFromName(action.value)};
}
