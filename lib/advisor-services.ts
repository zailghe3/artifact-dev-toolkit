import type { AdvisorSettings } from "../adt-runtime/src/operational-settings-contract.ts";
import { requestRuntimeOperationalSettings } from "./adt-runtime-client.ts";
import { adtRuntimeConfiguration, getWorkflowEnvironment } from "./workflow-services.ts";

export async function getAdvisorSettingsStore() {
 const config = adtRuntimeConfiguration(await getWorkflowEnvironment() as unknown as Record<string, unknown>);
 return {
  get: (repositoryId: number) => requestRuntimeOperationalSettings(config, { operation: "advisor.get", repositoryId }),
  save: (repositoryId: number, settings: AdvisorSettings, revision: number) =>
   requestRuntimeOperationalSettings(config, { operation: "advisor.save", repositoryId, settings, revision }),
 };
}
