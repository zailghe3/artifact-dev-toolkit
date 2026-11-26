"use server";

import { requireDiagnosticsAccess } from "@/lib/auth";
import { collectEssentialRunnerDiagnostics } from "@/lib/codex-runner-diagnostics";
import { observe } from "@/lib/diagnostic-observations";
import { observeRuntimeReadiness } from "@/lib/diagnostic-readiness";
import { getRuntimeCodexRunnerClient } from "@/lib/workflow-services";
import { generateRepositoryDiagnostics } from "@/lib/repository-diagnostics";

export async function refreshRepositoryObservation() {
  const session = await requireDiagnosticsAccess();
  return observe(() => generateRepositoryDiagnostics(session));
}

export async function refreshRuntimeObservation() {
  await requireDiagnosticsAccess();
  return observe(observeRuntimeReadiness);
}

export async function refreshRunnerObservation() {
  const session = await requireDiagnosticsAccess();
  return observe(() => collectEssentialRunnerDiagnostics({ clientFactory: () => getRuntimeCodexRunnerClient(session.repositoryAuthorization.repositoryId!) }));
}
