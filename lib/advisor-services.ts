import {AdvisorSettingsStore} from "./advisor-settings.ts";
import {getWorkflowEnvironment} from "./workflow-services.ts";
import type {WorkflowD1Database} from "./workflow-d1-storage.ts";
export async function getAdvisorSettingsStore(){return new AdvisorSettingsStore((await getWorkflowEnvironment()).AUTH_SESSIONS_DB as unknown as WorkflowD1Database)}
