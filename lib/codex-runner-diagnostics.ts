import { CodexRunnerError, getCodexRunnerClient, type RunnerAuthEnvironmentDiagnostics, type RunnerAuthStatus, type RunnerCapabilities, type RunnerControlStatus, type RunnerEnvironmentDescriptor, type RunnerJobList, type RunnerSandboxDiagnostics, type RunnerWorkspaceDiagnostics } from "./codex-runner-client.ts";
import { evaluateRunnerCompatibility } from "./codex-runner-compatibility.ts";
import type { SafeCodexConnectionStatus } from "./codex-runner-status.ts";

export type RunnerObservation<T> = { state: "available"; value: T } | { state: "unavailable" } | { state: "not-observed" };
export type RunnerCapabilityFailure = "unreachable" | "access-denied" | "update-required" | "invalid-response" | "unknown";
export type RunnerCapabilityObservation = { state: "available"; value: RunnerCapabilities } | { state: "unavailable"; reason: RunnerCapabilityFailure };
export type SafeRunnerEnvironmentDiagnostic = { environment: RunnerEnvironmentDescriptor; workspace: RunnerObservation<RunnerWorkspaceDiagnostics>; sandbox: RunnerObservation<RunnerSandboxDiagnostics | null> };
export type SafeRunnerDiagnostics = {
  connection: SafeCodexConnectionStatus;
  capabilities: RunnerCapabilityObservation;
  authentication: RunnerObservation<RunnerAuthStatus>;
  control: RunnerObservation<RunnerControlStatus>;
  environments: RunnerObservation<SafeRunnerEnvironmentDiagnostic[]>;
  jobs: RunnerObservation<RunnerJobList>;
  authEnvironment: RunnerObservation<RunnerAuthEnvironmentDiagnostics>;
};

type RunnerDiagnosticClient = Pick<ReturnType<typeof getCodexRunnerClient>, "capabilities" | "authStatus" | "controlStatus" | "environments" | "workspaceDiagnostics" | "sandboxDiagnostics" | "jobs" | "authEnvironmentDiagnostics">;
type Dependencies = { clientFactory?: () => RunnerDiagnosticClient; logger?: (message: string) => void };
const unavailable = <T>(): RunnerObservation<T> => ({ state: "unavailable" });
const notObserved = <T>(): RunnerObservation<T> => ({ state: "not-observed" });
const observation = <T>(result: PromiseSettledResult<T>): RunnerObservation<T> => result.status === "fulfilled" ? { state: "available", value: result.value } : unavailable();

function capabilityFailure(error: unknown): RunnerCapabilityFailure {
  if (!(error instanceof CodexRunnerError)) return "unknown";
  if (error.category === "runner_update_required") return "update-required";
  if (error.category === "access_denied" || error.category === "runner_unauthorized") return "access-denied";
  if (error.category === "invalid_response") return "invalid-response";
  if (error.category === "runner_unavailable" && error.transport) return "unreachable";
  return "unknown";
}

async function collectEnvironments(client: RunnerDiagnosticClient, integrated: boolean): Promise<SafeRunnerEnvironmentDiagnostic[]> {
  const environments = await client.environments();
  return Promise.all(environments.map(async environment => {
    if (!environment.enabled) return { environment, workspace: notObserved(), sandbox: notObserved() };
    const workspace = observation((await Promise.allSettled([client.workspaceDiagnostics(environment.key)]))[0]);
    const sandbox = integrated ? observation((await Promise.allSettled([client.sandboxDiagnostics(environment.key)]))[0]) : notObserved<RunnerSandboxDiagnostics | null>();
    return { environment, workspace, sandbox };
  }));
}

function connectionFrom(capabilities: RunnerCapabilityObservation, authentication: RunnerObservation<RunnerAuthStatus>): SafeCodexConnectionStatus {
  if (capabilities.state === "unavailable") return capabilities.reason === "update-required" ? { state: "update-required", label: "Runner update required" } : { state: "unavailable", label: "Runner unavailable" };
  const value = capabilities.value, compatibility = evaluateRunnerCompatibility(value);
  if (!value.codexAvailable) return { state: "unavailable", label: "Runner unavailable", capabilities: value, compatibility };
  if (!value.deviceAuth) return { state: "update-required", label: "Runner update required", capabilities: value, compatibility };
  if (authentication.state !== "available") return { state: "unavailable", label: "Runner authentication status unavailable", capabilities: value, compatibility };
  return authentication.value.connected ? { state: "connected", label: "Connected to ChatGPT", capabilities: value, compatibility, auth: authentication.value } : { state: "disconnected", label: "Runner ready — ChatGPT not connected", capabilities: value, compatibility, auth: authentication.value };
}

export async function collectSafeRunnerDiagnostics(dependencies: Dependencies = {}): Promise<SafeRunnerDiagnostics> {
  const logger = dependencies.logger ?? console.error;
  let client: RunnerDiagnosticClient;
  try { client = (dependencies.clientFactory ?? getCodexRunnerClient)(); }
  catch (error) {
    const connection: SafeCodexConnectionStatus = error instanceof CodexRunnerError && error.category === "configuration_missing" ? { state: "configuration-missing", label: "Runner configuration missing" } : { state: "unavailable", label: "Runner unavailable" };
    return { connection, capabilities: { state: "unavailable", reason: "unknown" }, authentication: unavailable(), control: unavailable(), environments: unavailable(), jobs: unavailable(), authEnvironment: unavailable() };
  }
  const capabilitiesResult = (await Promise.allSettled([client.capabilities()]))[0];
  const capabilitiesFailure = capabilitiesResult.status === "rejected" ? capabilityFailure(capabilitiesResult.reason) : undefined;
  const capabilities: RunnerCapabilityObservation = capabilitiesResult.status === "fulfilled" ? { state: "available", value: capabilitiesResult.value } : { state: "unavailable", reason: capabilitiesFailure! };
  if (capabilitiesFailure) logger(JSON.stringify({ event: "codex_runner_diagnostics_failed", stage: "capabilities", reason: capabilitiesFailure }));
  const authenticationResult = capabilities.state === "available" ? (await Promise.allSettled([client.authStatus()]))[0] : { status: "rejected", reason: undefined } as PromiseRejectedResult;
  const authentication = observation(authenticationResult);
  if (capabilities.state === "available" && authenticationResult.status === "rejected") logger(JSON.stringify({ event: "codex_runner_diagnostics_failed", stage: "auth_status" }));
  const connection = connectionFrom(capabilities, authentication);
  const [controlResult, jobs, authEnvironment] = await Promise.allSettled([client.controlStatus(), client.jobs(5), client.authEnvironmentDiagnostics()]);
  const control = observation(controlResult);
  const integrated = control.state === "available" && control.value.role === "integrated";
  const environments = observation((await Promise.allSettled([collectEnvironments(client, integrated)]))[0]);
  return { connection, capabilities, authentication, control, environments, jobs: observation(jobs), authEnvironment: observation(authEnvironment) };
}
