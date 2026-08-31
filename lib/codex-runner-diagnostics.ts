import { CodexRunnerError, getCodexRunnerClient, type RunnerAuthEnvironmentDiagnostics, type RunnerAuthStatus, type RunnerCapabilities, type RunnerControlStatus, type RunnerEnvironmentDescriptor, type RunnerJobList, type RunnerSandboxDiagnostics, type RunnerWorkspaceDiagnostics } from "./codex-runner-client.ts";
import { evaluateRunnerCompatibility } from "./codex-runner-compatibility.ts";
import type { SafeCodexConnectionStatus } from "./codex-runner-status.ts";

export type RunnerObservation<T> = { state: "available"; value: T } | { state: "unavailable" };
export type SafeRunnerEnvironmentDiagnostic = { environment: RunnerEnvironmentDescriptor; workspace: RunnerObservation<RunnerWorkspaceDiagnostics>; sandbox: RunnerObservation<RunnerSandboxDiagnostics | null> };
export type SafeRunnerDiagnostics = {
  connection: SafeCodexConnectionStatus;
  capabilities: RunnerObservation<RunnerCapabilities>;
  authentication: RunnerObservation<RunnerAuthStatus>;
  control: RunnerObservation<RunnerControlStatus>;
  environments: RunnerObservation<SafeRunnerEnvironmentDiagnostic[]>;
  jobs: RunnerObservation<RunnerJobList>;
  authEnvironment: RunnerObservation<RunnerAuthEnvironmentDiagnostics>;
};

type RunnerDiagnosticClient = Pick<ReturnType<typeof getCodexRunnerClient>, "capabilities" | "authStatus" | "controlStatus" | "environments" | "workspaceDiagnostics" | "sandboxDiagnostics" | "jobs" | "authEnvironmentDiagnostics">;
type StatusLogger = (message: string) => void;
type Dependencies = { clientFactory?: () => RunnerDiagnosticClient; logger?: StatusLogger };
const unavailable = <T>(): RunnerObservation<T> => ({ state: "unavailable" });
const observation = <T>(result: PromiseSettledResult<T>): RunnerObservation<T> => result.status === "fulfilled" ? { state: "available", value: result.value } : unavailable();

async function collectEnvironments(client: RunnerDiagnosticClient): Promise<SafeRunnerEnvironmentDiagnostic[]> {
  const environments = await client.environments();
  return Promise.all(environments.map(async environment => {
    const [workspace, sandbox] = await Promise.allSettled([client.workspaceDiagnostics(environment.key), client.sandboxDiagnostics(environment.key)]);
    return { environment, workspace: observation(workspace), sandbox: observation(sandbox) };
  }));
}

function connectionFrom(capabilities: RunnerObservation<RunnerCapabilities>, authentication: RunnerObservation<RunnerAuthStatus>): SafeCodexConnectionStatus {
  if (capabilities.state === "unavailable") return { state: "unavailable", label: "Runner unavailable" };
  const value = capabilities.value, compatibility = evaluateRunnerCompatibility(value);
  if (!value.codexAvailable) return { state: "unavailable", label: "Runner unavailable", capabilities: value, compatibility };
  if (!value.deviceAuth) return { state: "update-required", label: "Runner update required", capabilities: value, compatibility };
  if (authentication.state === "unavailable") return { state: "unavailable", label: "Runner authentication status unavailable", capabilities: value, compatibility };
  return authentication.value.connected ? { state: "connected", label: "Connected to ChatGPT", capabilities: value, compatibility, auth: authentication.value } : { state: "disconnected", label: "Runner ready — ChatGPT not connected", capabilities: value, compatibility, auth: authentication.value };
}

export async function collectSafeRunnerDiagnostics(dependencies: Dependencies = {}): Promise<SafeRunnerDiagnostics> {
  const logger = dependencies.logger ?? console.error;
  let client: RunnerDiagnosticClient;
  try { client = (dependencies.clientFactory ?? getCodexRunnerClient)(); }
  catch (error) {
    const connection: SafeCodexConnectionStatus = error instanceof CodexRunnerError && error.category === "configuration_missing" ? { state: "configuration-missing", label: "Runner configuration missing" } : { state: "unavailable", label: "Runner unavailable" };
    return { connection, capabilities: unavailable(), authentication: unavailable(), control: unavailable(), environments: unavailable(), jobs: unavailable(), authEnvironment: unavailable() };
  }
  const capabilitiesResult = await Promise.allSettled([client.capabilities()]).then(([result]) => result);
  const capabilities = observation(capabilitiesResult);
  if (capabilitiesResult.status === "rejected") logger(JSON.stringify({ event: "codex_runner_diagnostics_failed", stage: "capabilities" }));
  const authenticationResult = capabilities.state === "available" ? await Promise.allSettled([client.authStatus()]).then(([result]) => result) : { status: "rejected", reason: undefined } as PromiseRejectedResult;
  const authentication = observation(authenticationResult);
  if (capabilities.state === "available" && authenticationResult.status === "rejected") logger(JSON.stringify({ event: "codex_runner_diagnostics_failed", stage: "auth_status" }));
  const connection = connectionFrom(capabilities, authentication);
  const [control, environments, jobs, authEnvironment] = await Promise.allSettled([client.controlStatus(), collectEnvironments(client), client.jobs(5), client.authEnvironmentDiagnostics()]);
  return { connection, capabilities, authentication, control: observation(control), environments: observation(environments), jobs: observation(jobs), authEnvironment: observation(authEnvironment) };
}
