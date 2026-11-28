import "server-only";
import { createDeploymentMetadata } from "./deployment-metadata.ts";

export function getDeploymentMetadata() {
  return createDeploymentMetadata({
    deployedAt: process.env.ADT_DEPLOYED_AT,
    commitSha: process.env.ADT_DEPLOY_COMMIT_SHA,
    pullRequestNumber: process.env.ADT_DEPLOY_PULL_REQUEST_NUMBER,
    repository: process.env.ADT_DEPLOY_REPOSITORY,
  });
}
