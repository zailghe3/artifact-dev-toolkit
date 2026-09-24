import {listOpenAIModels,validateOpenAIModel} from "./openai-models.ts";
import {requireProviderConnectionType} from "./provider-connection-types.ts";

export type ProviderModelOperations={listOpenAIModels:typeof listOpenAIModels;validateOpenAIModel:typeof validateOpenAIModel};
const defaults:ProviderModelOperations={listOpenAIModels,validateOpenAIModel};

/** Provider-aware dispatch for model discovery and validation. Credentials remain call-scoped. */
export class ProviderModelService{
 private operations:ProviderModelOperations;
 constructor(operations:ProviderModelOperations=defaults){this.operations=operations}
 async list(connectionType:string,credential:string){const type=requireProviderConnectionType(connectionType);if(!type.model.discovery)throw new Error("model_discovery_unsupported");switch(type.provider){case "openai":return this.operations.listOpenAIModels(credential)}}
 async validate(connectionType:string,credential:string,model:string|undefined){const type=requireProviderConnectionType(connectionType);if(type.model.required&&!model)throw new Error("model_required");switch(type.provider){case "openai":return this.operations.validateOpenAIModel(credential,model!)}}
}
export const providerModelService=new ProviderModelService();
