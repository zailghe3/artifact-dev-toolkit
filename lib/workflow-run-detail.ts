import { getWorkflowRunStorage } from "./workflow-services.ts";
import type { RunDetail } from "./workflow-storage.ts";

export async function getWorkflowRunDetail(runId: string, repositoryId: number): Promise<RunDetail | undefined> {
  return (await getWorkflowRunStorage(repositoryId)).getRun(runId);
}
