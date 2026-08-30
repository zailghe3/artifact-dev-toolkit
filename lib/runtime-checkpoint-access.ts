import type {WorkflowRunStorage} from "./workflow-storage.ts";
import {isLegacyRunReadOnly} from "./workflow-run-legacy.ts";

export async function requireCurrentCheckpointRun(storage:WorkflowRunStorage,runId:string){
  const detail=await storage.getRun(runId);
  if(!detail||isLegacyRunReadOnly(detail.run))throw new Error("checkpoint_authority_invalid");
  return detail.run;
}
