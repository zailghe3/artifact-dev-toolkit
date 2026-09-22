import { z } from "zod";

const state = z.enum(["healthy", "degraded", "failed", "not-configured", "unknown"]);
const sha = z.string().regex(/^[0-9a-f]{7,64}$/i).optional();
const base = { observedAt: z.string().datetime(), state };

const inputSchema = z.discriminatedUnion("domain", [
  z.object({ domain: z.literal("authentication-access"), ...base, repositoryMatch: z.enum(["match", "mismatch", "unknown"]), authorization: z.enum(["authorized", "denied", "temporarily_unavailable", "not_checked"]), installation: z.enum(["detected", "missing", "unavailable", "unknown"]), contentsRead: z.enum(["granted", "denied", "unknown"]), contentsWrite: z.enum(["granted", "denied", "unknown"]) }).strict(),
  z.object({ domain: z.literal("artifact-library"), ...base, repository: z.string().max(256), branch: z.string().max(256), repositoryRevision: sha, catalogue: z.enum(["fresh", "stale", "missing", "degraded", "corrupt", "unavailable"]), cacheRevision: sha, artifactCount: z.number().int().nonnegative().optional(), validation: z.enum(["not_run", "valid", "invalid", "unavailable"]), validCount: z.number().int().nonnegative().optional(), invalidCount: z.number().int().nonnegative().optional(), validationCodes: z.array(z.string().regex(/^[a-z0-9_.-]{1,80}$/i)).max(20), omittedErrorCount: z.number().int().nonnegative().max(100000).optional() }).strict(),
  z.object({ domain: z.literal("application-control-plane"), ...base, deployedRevision: sha, pullRequest: z.number().int().positive().optional(), deployedAt: z.string().datetime().optional(), freshness: z.enum(["current", "superseded", "unknown"]), workerRevision: sha, runtimeRevision: sha, runnerRevision: sha }).strict(),
  z.object({ domain: z.literal("adt-runtime"), ...base, configured: z.boolean(), reachable: z.boolean(), authenticationAccepted: z.boolean().nullable(), protocolCompatible: z.boolean(), openaiAgents: z.boolean(), langgraphGraph: z.boolean(), wrappingKeyCompatible: z.boolean(), elapsedMs: z.number().int().nonnegative().max(60000), runtimeRevision: sha, httpStatus: z.number().int().min(100).max(599).optional() }).strict(),
  z.object({ domain: z.literal("codex-runner"), ...base, connection: z.enum(["configuration-missing", "unavailable", "update-required", "disconnected", "waiting", "connected"]), protocol: z.enum(["compatible", "incompatible", "unknown"]), runnerRelease: z.enum(["current", "update_available", "runner_newer_than_adt", "unknown"]), codexVersion: z.enum(["current", "mismatch", "unknown"]), runnerBuild: sha, emergencyStop: z.union([z.boolean(), z.literal("unknown")]), executorHealthy: z.union([z.boolean(), z.literal("unknown")]) }).strict(),
]);

export type SafeDiagnosticReportInput = z.input<typeof inputSchema>;
export type SafeDiagnosticReport = { summary: string; technical: string };
const titles: Record<SafeDiagnosticReportInput["domain"], string> = { "authentication-access": "Authentication & access", "artifact-library": "Artifact Library", "application-control-plane": "Application / control plane", "adt-runtime": "ADT Runtime", "codex-runner": "Codex Runner" };

export function buildDiagnosticReport(value: unknown): SafeDiagnosticReport {
  const input = inputSchema.parse(value);
  const { domain, observedAt, state: currentState, ...technical } = input;
  const title = titles[domain];
  const reasons: string[] = [];
  if (domain === "authentication-access") {
    if (input.repositoryMatch !== "match") reasons.push(`Repository alignment: ${input.repositoryMatch}`);
    if (input.authorization !== "authorized") reasons.push(`Repository authorization: ${input.authorization}`);
  } else if (domain === "artifact-library") {
    if (input.catalogue !== "fresh") reasons.push(`Catalogue: ${input.catalogue}`);
    if (input.validation !== "valid" && input.validation !== "not_run") reasons.push(`Artifact validation: ${input.validation}`);
  } else if (domain === "application-control-plane" && input.freshness !== "current") reasons.push(`Infrastructure freshness: ${input.freshness}`);
  else if (domain === "adt-runtime" && currentState !== "healthy") reasons.push("Runtime is not ready for Workflow execution.");
  else if (domain === "codex-runner") {
    if (input.runnerRelease === "update_available") reasons.push("Runner update required.");
    if (input.emergencyStop === true) reasons.push("Emergency stop is active.");
    if (input.executorHealthy === false) reasons.push("Runner executor is unhealthy.");
  }
  const summary = [`${title} diagnostics`, `Observed: ${observedAt}`, `Status: ${currentState}`, ...reasons.map(reason => `- ${reason}`)].join("\n");
  return { summary, technical: JSON.stringify({ schema: "adt.safe-diagnostics.v1", domain, observedAt, status: currentState, reasons, technical }, null, 2) };
}
