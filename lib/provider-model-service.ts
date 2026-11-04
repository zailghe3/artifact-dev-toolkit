import {listOpenAIModels,validateOpenAIModel} from "./openai-models.ts";
import {listAnthropicModels,validateAnthropicModel} from "./anthropic-models.ts";
import {assertProviderCredentialContract,normalizeProviderSafeConfiguration,requireProviderConnectionType,type ProviderConnectionTypePolicy,type ProviderSafeConfiguration} from "./provider-connection-types.ts";

export type ProviderModelOperations={listOpenAIModels:typeof listOpenAIModels;validateOpenAIModel:typeof validateOpenAIModel;listAnthropicModels:typeof listAnthropicModels;validateAnthropicModel:typeof validateAnthropicModel;listRuntimeModels?:(configuration:ProviderSafeConfiguration,credential?:string)=>Promise<string[]>};
const defaults:ProviderModelOperations={listOpenAIModels,validateOpenAIModel,listAnthropicModels,validateAnthropicModel};

/** Provider-aware dispatch for model discovery and validation. Credentials remain call-scoped. */
export class ProviderModelService{
 private operations:ProviderModelOperations;
 constructor(operations:Partial<ProviderModelOperations>=defaults){this.operations={...defaults,...operations}}
 async list(connectionType:string,credential:string|undefined,configuration?:unknown){const type=requireProviderConnectionType(connectionType);return this.listForPolicy(type,credential,normalizeProviderSafeConfiguration(type,configuration))}
 async listForPolicy(type:ProviderConnectionTypePolicy,credential:string|undefined,configuration?:ProviderSafeConfiguration){if(!type.model.discovery)throw new Error("model_discovery_unsupported");if(type.model.location==="adt-runtime"){configuration=normalizeProviderSafeConfiguration(type,configuration);assertProviderCredentialContract(type,configuration,credential);if(!this.operations.listRuntimeModels)throw new Error("connection_unavailable");return this.operations.listRuntimeModels(configuration!,credential)}if(!credential)throw new Error("credential_required");switch(type.provider){case "openai":return this.operations.listOpenAIModels(credential);case "anthropic":return this.operations.listAnthropicModels(credential,configuration);default:throw new Error("model_discovery_unsupported")}}
 async validate(connectionType:string,credential:string|undefined,model:string|undefined,configuration?:unknown){const type=requireProviderConnectionType(connectionType);return this.validateForPolicy(type,credential,model,normalizeProviderSafeConfiguration(type,configuration))}
 async validateForPolicy(type:ProviderConnectionTypePolicy,credential:string|undefined,model:string|undefined,configuration?:ProviderSafeConfiguration){if(!type.model.required)return;if(!model)throw new Error("model_required");if(type.model.location==="adt-runtime"){const models=await this.listForPolicy(type,credential,configuration);if(!models.includes(model))throw Object.assign(new Error("provider_rejected"),{category:"provider_rejected",safeMessage:"Selected Ollama model is unavailable."});return}if(!credential)throw new Error("credential_required");switch(type.provider){case "openai":return this.operations.validateOpenAIModel(credential,model);case "anthropic":return this.operations.validateAnthropicModel(credential,model,configuration);default:throw new Error("model_validation_unsupported")}}
}
export const providerModelService=new ProviderModelService();
