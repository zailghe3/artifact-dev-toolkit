import type { Artifact } from "./artifact-repository.ts";

export type TagSuggestion = { value: string; count: number };
export type TagOption = TagSuggestion & { kind: "suggestion" } | { kind: "create"; value: string; count: 0 };
export const TAG_SUGGESTION_LIMIT = 8;

export function collectTagSuggestions(artifacts: Pick<Artifact, "tags">[]): TagSuggestion[] {
  const counts = new Map<string, number>();
  for (const artifact of artifacts) {
    for (const tag of artifact.tags) {
      const value = tag.trim();
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts].map(([value, count]) => ({ value, count })).sort(compareTagSuggestions);
}

function compareTagSuggestions(a: TagSuggestion, b: TagSuggestion) {
  return b.count - a.count || a.value.localeCompare(b.value, undefined, { sensitivity: "base" }) || a.value.localeCompare(b.value);
}

export function filterTagSuggestions(suggestions: TagSuggestion[], query: string, selected: string[], limit = TAG_SUGGESTION_LIMIT): TagSuggestion[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const selectedExact = new Set(selected);
  const matches = suggestions.filter((suggestion) => !selectedExact.has(suggestion.value) && (!normalizedQuery || suggestion.value.toLocaleLowerCase().includes(normalizedQuery)));
  return matches.sort((a, b) => {
    const aPrefix = normalizedQuery ? a.value.toLocaleLowerCase().startsWith(normalizedQuery) : true;
    const bPrefix = normalizedQuery ? b.value.toLocaleLowerCase().startsWith(normalizedQuery) : true;
    if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
    return compareTagSuggestions(a, b);
  }).slice(0, limit);
}

export function addTagValue(values: string[], input: string, suggestions: TagSuggestion[] = []): string[] {
  const trimmed = input.trim();
  if (!trimmed || values.includes(trimmed)) return values;
  const catalogue = suggestions.find((suggestion) => suggestion.value.toLocaleLowerCase() === trimmed.toLocaleLowerCase());
  const value = catalogue?.value ?? trimmed;
  if (values.includes(value)) return values;
  return [...values, value];
}

export function removeTagValue(values: string[], value: string): string[] { return values.filter((tag) => tag !== value); }

export function tagOptions(suggestions: TagSuggestion[], query: string, selected: string[], limit = TAG_SUGGESTION_LIMIT): TagOption[] {
  const filtered = filterTagSuggestions(suggestions, query, selected, limit);
  const trimmed = query.trim();
  const exact = suggestions.some((suggestion) => suggestion.value.toLocaleLowerCase() === trimmed.toLocaleLowerCase());
  const suggestionOptions = filtered.map((suggestion) => ({ ...suggestion, kind: "suggestion" as const }));
  return trimmed && !exact ? [...suggestionOptions, { kind: "create", value: trimmed, count: 0 }] : suggestionOptions;
}

export type ComboboxState = { open: boolean; activeIndex: number };
export function comboboxQueryChanged(state: ComboboxState, optionCount: number): ComboboxState { return { open: optionCount > 0, activeIndex: -1 }; }
export function comboboxBlurred(state: ComboboxState): ComboboxState { return state; }
export function comboboxEscaped(state: ComboboxState): ComboboxState { return { ...state, open: false, activeIndex: -1 }; }
export function comboboxMoved(state: ComboboxState, optionCount: number, direction: 1 | -1): ComboboxState {
  if (!optionCount) return { open: false, activeIndex: -1 };
  const current = state.open ? state.activeIndex : -1;
  return { open: true, activeIndex: (current + direction + optionCount) % optionCount };
}
export function comboboxSelected(): ComboboxState { return { open: false, activeIndex: -1 }; }
