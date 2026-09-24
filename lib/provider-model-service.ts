import {listOpenAIModels,validateOpenAIModel} from "./openai-models.ts";
import {requireProviderConnectionType,type ProviderConnectionTypePolicy} from "./provider-connection-types.ts";

export type ProviderModelOperations={listOpenAIModels:typeof listOpenAIModels;validateOpenAIModel:typeof validateOpenAIModel};
const defaults:ProviderModelOperations={listOpenAIModels,validateOpenAIModel};

/** Provider-aware dispatch for model discovery and validation. Credentials remain call-scoped. */
export class ProviderModelService{
 private operations:ProviderModelOperations;
 constructor(operations:ProviderModelOperations=defaults){this.operations=operations}
 async list(connectionType:string,credential:string){return this.listForPolicy(requireProviderConnectionType(connectionType),credential)}
 async listForPolicy(type:ProviderConnectionTypePolicy,credential:string){if(!type.model.discovery)throw new Error("model_discovery_unsupported");switch(type.provider){case "openai":return this.operations.listOpenAIModels(credential);default:throw new Error("model_discovery_unsupported")}}
 async validate(connectionType:string,credential:string,model:string|undefined){return this.validateForPolicy(requireProviderConnectionType(connectionType),credential,model)}
 async validateForPolicy(type:ProviderConnectionTypePolicy,credential:string,model:string|undefined){if(!type.model.required)return;if(!model)throw new Error("model_required");switch(type.provider){case "openai":return this.operations.validateOpenAIModel(credential,model);default:throw new Error("model_validation_unsupported")}}
}
export const providerModelService=new ProviderModelService();
