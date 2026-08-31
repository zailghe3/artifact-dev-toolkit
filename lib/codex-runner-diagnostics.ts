import { CodexRunnerError, getCodexRunnerClient, type RunnerAuthEnvironmentDiagnostics, type RunnerControlStatus, type RunnerEnvironmentDescriptor, type RunnerJobList, type RunnerSandboxDiagnostics, type RunnerWorkspaceDiagnostics } from "./codex-runner-client.ts";
import { getSafeCodexConnectionStatus, type SafeCodexConnectionStatus } from "./codex-runner-status.ts";

export type RunnerObservation<T> = { state: "available"; value: T } | { state: "unavailable" };
export type SafeRunnerEnvironmentDiagnostic = { environment: RunnerEnvironmentDescriptor; workspace: RunnerObservation<RunnerWorkspaceDiagnostics>; sandbox: RunnerObservation<RunnerSandboxDiagnostics | null> };
export type SafeRunnerDiagnostics = {
  connection: SafeCodexConnectionStatus;
  control: RunnerObservation<RunnerControlStatus>;
  environments: RunnerObservation<SafeRunnerEnvironmentDiagnostic[]>;
  jobs: RunnerObservation<RunnerJobList>;
  authEnvironment: RunnerObservation<RunnerAuthEnvironmentDiagnostics>;
};

type RunnerDiagnosticClient = Pick<ReturnType<typeof getCodexRunnerClient>, "capabilities" | "authStatus" | "controlStatus" | "environments" | "workspaceDiagnostics" | "sandboxDiagnostics" | "jobs" | "authEnvironmentDiagnostics">;
type Dependencies = { clientFactory?: () => RunnerDiagnosticClient; logger?: (message: string) => void };
const unavailable = <T>(): RunnerObservation<T> => ({ state: "unavailable" });
const observation = <T>(result: PromiseSettledResult<T>): RunnerObservation<T> => result.status === "fulfilled" ? { state: "available", value: result.value } : unavailable();

async function collectEnvironments(client: RunnerDiagnosticClient): Promise<SafeRunnerEnvironmentDiagnostic[]> {
  const environments = await client.environments();
  return Promise.all(environments.map(async environment => {
    const [workspace, sandbox] = await Promise.allSettled([client.workspaceDiagnostics(environment.key), client.sandboxDiagnostics(environment.key)]);
    return { environment, workspace: observation(workspace), sandbox: observation(sandbox) };
  }));
}

export async function collectSafeRunnerDiagnostics(dependencies: Dependencies = {}): Promise<SafeRunnerDiagnostics> {
  const logger = dependencies.logger ?? console.error;
  let client: RunnerDiagnosticClient;
  try { client = (dependencies.clientFactory ?? getCodexRunnerClient)(); }
  catch (error) {
    const connection: SafeCodexConnectionStatus = error instanceof CodexRunnerError && error.category === "configuration_missing" ? { state: "configuration-missing", label: "Runner configuration missing" } : { state: "unavailable", label: "Runner unavailable" };
    return { connection, control: unavailable(), environments: unavailable(), jobs: unavailable(), authEnvironment: unavailable() };
  }
  const connection = await getSafeCodexConnectionStatus({ clientFactory: () => client, logger });
  if (connection.state === "configuration-missing") return { connection, control: unavailable(), environments: unavailable(), jobs: unavailable(), authEnvironment: unavailable() };
  const [control, environments, jobs, authEnvironment] = await Promise.allSettled([client.controlStatus(), collectEnvironments(client), client.jobs(5), client.authEnvironmentDiagnostics()]);
  return { connection, control: observation(control), environments: observation(environments), jobs: observation(jobs), authEnvironment: observation(authEnvironment) };
}
