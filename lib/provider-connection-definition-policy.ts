import type {ConnectionDefinition} from "./workflow-connection-definitions.ts";
import {normalizeConnectionModel,normalizeProviderSafeConfiguration,type ProviderConnectionTypePolicy} from "./provider-connection-types.ts";

type SafeDefinitionInput={schemaVersion:1;id:string;name:string;credential:ConnectionDefinition["credential"]};
/** Builds validated safe Git configuration without carrying fields from a previous connection type. */
export function buildProviderConnectionDefinition(policy:ProviderConnectionTypePolicy,input:SafeDefinitionInput,model?:string,configuration?:unknown){const normalized=normalizeProviderSafeConfiguration(policy,configuration);return{...input,runtime:policy.id,provider:policy.provider,...normalizeConnectionModel(policy,model),...(normalized?{configuration:normalized}:{})};}
