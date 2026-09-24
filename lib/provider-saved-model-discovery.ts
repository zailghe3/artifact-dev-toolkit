import {assertCompatibleConnectionTypeChange} from "./provider-authentication-lifecycle.ts";
import {normalizeProviderSafeConfiguration,requireProviderConnectionType} from "./provider-connection-types.ts";
import type {ProviderModelService} from "./provider-model-service.ts";
import type {WorkflowConnectionDefinitionRepository} from "./workflow-connection-definition-repository.ts";
import type {WorkflowProviderConnectionStore} from "./workflow-provider-connection-store.ts";

/** Lists models with a saved credential and the current, policy-validated browser-safe configuration. */
export async function listSavedProviderModels(connectionKey:string,connectionType:string,configuration:unknown,repository:Pick<WorkflowConnectionDefinitionRepository,"getConnection">,store:Pick<WorkflowProviderConnectionStore,"resolveForExecution">,models:Pick<ProviderModelService,"listForPolicy">){
 const current=await repository.getConnection(connectionKey);if(!current)throw new Error("connection_unavailable");
 const currentType=requireProviderConnectionType(current.definition.runtime),targetType=requireProviderConnectionType(connectionType);assertCompatibleConnectionTypeChange(currentType,targetType);
 const safeConfiguration=normalizeProviderSafeConfiguration(targetType,configuration),resolved=await store.resolveForExecution(connectionKey);if(!resolved.credential)throw new Error("connection_unavailable");
 return models.listForPolicy(targetType,resolved.credential,safeConfiguration);
}
