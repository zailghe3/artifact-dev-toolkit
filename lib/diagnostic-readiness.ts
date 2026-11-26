import "server-only";

import { resolveRuntimeReleaseFreshness } from "@/lib/infrastructure-freshness-live";
import { diagnoseADTRuntime } from "@/lib/workflow-services";

export async function observeRuntimeReadiness() {
  const runtime = await diagnoseADTRuntime();
  const freshness = resolveRuntimeReleaseFreshness(runtime);
  return { ...runtime, runtimeFreshness: freshness.state, expectedRuntimeReleaseRevision: freshness.expectedReleaseRevision };
}
