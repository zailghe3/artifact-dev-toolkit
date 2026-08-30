import type {WorkflowRun} from "./workflow-storage.ts";
export const LEGACY_RUN_READ_ONLY_MESSAGE="Legacy run — read only";
export const LEGACY_RUN_READ_ONLY_ERROR="legacy_run_read_only";
export function legacyRunReadOnlyReason(run:Pick<WorkflowRun,"engineVersion"|"executionPlan"|"connectionSnapshots">){if(run.engineVersion==="1")return "engine_v1" as const;if(!run.executionPlan||!("planVersion" in run.executionPlan)||run.executionPlan.planVersion!==2)return "historical_execution_plan" as const;for(const connection of Object.values(run.connectionSnapshots)){if(connection.management==="d1")return "d1_provider_configuration" as const;if(connection.management==="git"&&connection.credentialSource!=="adt-vault")return "cloudflare_binding_credential" as const;}return undefined;}
export function isLegacyRunReadOnly(run:Pick<WorkflowRun,"engineVersion"|"executionPlan"|"connectionSnapshots">){return legacyRunReadOnlyReason(run)!==undefined;}
export function assertRunExecutable(run:Pick<WorkflowRun,"engineVersion"|"executionPlan"|"connectionSnapshots">){if(isLegacyRunReadOnly(run))throw new Error(LEGACY_RUN_READ_ONLY_ERROR);}
