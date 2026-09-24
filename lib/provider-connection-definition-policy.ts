import type {ConnectionDefinition} from "./workflow-connection-definitions.ts";
import {normalizeConnectionModel,type ProviderConnectionTypePolicy} from "./provider-connection-types.ts";

type SafeDefinitionInput={schemaVersion:1;id:string;name:string;credential:ConnectionDefinition["credential"]};
/** Builds safe Git configuration from policy without carrying fields from a previous connection type. */
export function buildProviderConnectionDefinition(policy:ProviderConnectionTypePolicy,input:SafeDefinitionInput,model?:string){return{...input,runtime:policy.id,provider:policy.provider,...normalizeConnectionModel(policy,model)};}
