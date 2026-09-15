export type DeploymentComponentImpact = {
  worker: boolean;
  runtime: boolean;
  runner: boolean;
};

export function isAppBuildPath(path: string): boolean;
export function isRuntimeImagePath(path: string): boolean;
export function isRunnerImagePath(path: string): boolean;
export function deploymentComponentImpact(paths: string[]): DeploymentComponentImpact;
