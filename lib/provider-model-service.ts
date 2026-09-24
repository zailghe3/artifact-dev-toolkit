import {listOpenAIModels,validateOpenAIModel} from "./openai-models.ts";
import {listAnthropicModels,validateAnthropicModel} from "./anthropic-models.ts";
import {requireProviderConnectionType,type ProviderConnectionTypePolicy} from "./provider-connection-types.ts";

export type ProviderModelOperations={listOpenAIModels:typeof listOpenAIModels;validateOpenAIModel:typeof validateOpenAIModel;listAnthropicModels:typeof listAnthropicModels;validateAnthropicModel:typeof validateAnthropicModel};
const defaults:ProviderModelOperations={listOpenAIModels,validateOpenAIModel,listAnthropicModels,validateAnthropicModel};

/** Provider-aware dispatch for model discovery and validation. Credentials remain call-scoped. */
export class ProviderModelService{
 private operations:ProviderModelOperations;
 constructor(operations:Partial<ProviderModelOperations>=defaults){this.operations={...defaults,...operations}}
 async list(connectionType:string,credential:string){return this.listForPolicy(requireProviderConnectionType(connectionType),credential)}
 async listForPolicy(type:ProviderConnectionTypePolicy,credential:string){if(!type.model.discovery)throw new Error("model_discovery_unsupported");switch(type.provider){case "openai":return this.operations.listOpenAIModels(credential);case "anthropic":return this.operations.listAnthropicModels(credential);default:throw new Error("model_discovery_unsupported")}}
 async validate(connectionType:string,credential:string,model:string|undefined){return this.validateForPolicy(requireProviderConnectionType(connectionType),credential,model)}
 async validateForPolicy(type:ProviderConnectionTypePolicy,credential:string,model:string|undefined){if(!type.model.required)return;if(!model)throw new Error("model_required");switch(type.provider){case "openai":return this.operations.validateOpenAIModel(credential,model);case "anthropic":return this.operations.validateAnthropicModel(credential,model);default:throw new Error("model_validation_unsupported")}}
}
export const providerModelService=new ProviderModelService();
