import type { Artifact } from "./artifact-repository.ts";

/** Statusless migration content has no mutable lifecycle until Phase 3. */
export function isCompatibilityReadOnly(artifact: Pick<Artifact, "layout" | "status">) {
  return artifact.status === undefined;
}

export function artifactLifecycleLabel(artifact: Pick<Artifact, "layout" | "status">) {
  return isCompatibilityReadOnly(artifact) ? "Compatibility · read-only" : artifact.status;
}
