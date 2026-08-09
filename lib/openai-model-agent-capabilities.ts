import type {OpenAIResponsesOptions} from "./workflow-adapter.ts";
export type OpenAIModelAgentCapabilities={reasoningEfforts?:readonly NonNullable<OpenAIResponsesOptions["reasoningEffort"]>[];verbosity?:readonly NonNullable<OpenAIResponsesOptions["verbosity"]>[];maxOutputTokens?:number};
const documented:Readonly<Record<string,OpenAIModelAgentCapabilities>>={
 "gpt-5":{reasoningEfforts:["low","medium","high"],verbosity:["low","medium","high"],maxOutputTokens:128000},
 "gpt-5.1":{reasoningEfforts:["none","low","medium","high"],verbosity:["low","medium","high"],maxOutputTokens:128000},
 "gpt-5.2":{reasoningEfforts:["none","low","medium","high","xhigh"],verbosity:["low","medium","high"],maxOutputTokens:128000},
 "gpt-5.4":{reasoningEfforts:["none","low","medium","high","xhigh"],verbosity:["low","medium","high"],maxOutputTokens:128000},
};
/** Unknown and dated model IDs deliberately receive no speculative controls. */
export function getOpenAIModelAgentCapabilities(model:string|undefined):OpenAIModelAgentCapabilities{return model?documented[model]??{}:{}}
export function validateOpenAIModelAgentOptions(model:string|undefined,options:OpenAIResponsesOptions){const capability=getOpenAIModelAgentCapabilities(model);if(options.reasoningEffort&&!capability.reasoningEfforts?.includes(options.reasoningEffort))throw new Error("unsupported_model_option:reasoningEffort");if(options.verbosity&&!capability.verbosity?.includes(options.verbosity))throw new Error("unsupported_model_option:verbosity");if(options.maxOutputTokens!==undefined&&capability.maxOutputTokens!==undefined&&options.maxOutputTokens>capability.maxOutputTokens)throw new Error("unsupported_model_option:maxOutputTokens");return options;}
