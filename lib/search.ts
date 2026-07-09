export type SearchableArtifact = {
  title: string;
  type: string;
  status: string;
  tags: string[];
  aliases: string[];
  body: string;
};

export function searchArtifacts<T extends SearchableArtifact>(artifacts: T[], query: string): T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return artifacts;
  const terms = normalized.split(/\s+/);

  return artifacts.filter((artifact) => {
    const haystack = [
      artifact.title,
      artifact.type,
      artifact.status,
      artifact.tags.join(" "),
      artifact.aliases.join(" "),
      artifact.body,
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
