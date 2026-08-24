import type { Artifact } from "./artifact-repository.ts";

/** Future-layout and statusless migration content has no mutable lifecycle in Phase 1. */
export function isCompatibilityReadOnly(artifact: Pick<Artifact, "layout" | "status">) {
  return artifact.layout === "future" || artifact.status === undefined;
}

export function artifactLifecycleLabel(artifact: Pick<Artifact, "layout" | "status">) {
  return isCompatibilityReadOnly(artifact) ? "Compatibility · read-only" : artifact.status;
}
