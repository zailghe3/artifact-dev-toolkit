export const PROVIDER_CONNECTION_TYPE_IDS=["openai-responses","openai-agents","anthropic-messages"] as const;
export type ProviderConnectionTypeId=typeof PROVIDER_CONNECTION_TYPE_IDS[number];
export type ProviderAuthenticationKind="api-key"|"delegated-oauth";
export type ProviderExecutionPath="direct"|"adt-runtime";
export type ProviderAgentSettingsFamily="none"|"openai-model"|"anthropic-messages";
export type ProviderSafeConfiguration=Readonly<Record<string,string>>;
export type ProviderSafeConfigurationPolicy={forExecution:boolean;parse(value:unknown):ProviderSafeConfiguration|undefined};
export type ProviderConnectionTypePolicy={
 id:string;provider:string;label:string;catalogueLabel:string;endpoint?:string;
 authentication:ProviderAuthenticationKind;model:{required:boolean;discovery:boolean;discoveryGuidance?:string};
 capabilities:{asynchronous:boolean;cancellation:boolean};execution:ProviderExecutionPath;
 agentSettings:ProviderAgentSettingsFamily;safeConfiguration:ProviderSafeConfigurationPolicy;
};
export type ProviderConnectionType=ProviderConnectionTypePolicy&{id:ProviderConnectionTypeId};

const noSafeConfiguration:ProviderSafeConfigurationPolicy={forExecution:false,parse(value){if(value!==undefined)throw new Error("provider_configuration_invalid");return undefined}};
const secretConfigurationFields=new Set(["apikey","clientsecret","refreshtoken","accesstoken","authorizationcode","pkceverifier","oauthstate"]);
export function createStringSafeConfigurationPolicy(fields:Record<string,{required?:boolean;maxLength:number;pattern?:RegExp}>,forExecution=true):ProviderSafeConfigurationPolicy{return{forExecution,parse(value){if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("provider_configuration_invalid");const input=value as Record<string,unknown>,output:Record<string,string>={};for(const key of Object.keys(input)){if(secretConfigurationFields.has(key.replace(/[^a-z]/gi,"").toLowerCase())||!fields[key])throw new Error("provider_configuration_invalid");const rule=fields[key],item=input[key];if(typeof item!=="string")throw new Error("provider_configuration_invalid");const normalized=item.trim();if(!normalized||normalized.length>rule.maxLength||(rule.pattern&&!rule.pattern.test(normalized)))throw new Error("provider_configuration_invalid");output[key]=normalized}for(const [key,rule] of Object.entries(fields))if(rule.required&&!output[key])throw new Error("provider_configuration_invalid");return output}}}
export function normalizeProviderSafeConfiguration(policy:Pick<ProviderConnectionTypePolicy,"safeConfiguration">,value:unknown){return policy.safeConfiguration.parse(value)}
const openAIModel={required:true,discovery:true,discoveryGuidance:"Search the models available to this authenticated OpenAI project."} as const;
const anthropicModel={required:true,discovery:true,discoveryGuidance:"Load models available to this authenticated Anthropic account or workspace."} as const;
const types:Record<ProviderConnectionTypeId,ProviderConnectionType>={
 "openai-responses":{id:"openai-responses",provider:"openai",label:"OpenAI Responses",catalogueLabel:"OpenAI Responses",endpoint:"https://api.openai.com/v1",authentication:"api-key",model:openAIModel,capabilities:{asynchronous:true,cancellation:true},execution:"direct",agentSettings:"openai-model",safeConfiguration:noSafeConfiguration},
 "openai-agents":{id:"openai-agents",provider:"openai",label:"OpenAI Agents (ADT Runtime)",catalogueLabel:"OpenAI Agents / ADT Runtime",endpoint:"https://api.openai.com/v1",authentication:"api-key",model:openAIModel,capabilities:{asynchronous:false,cancellation:false},execution:"adt-runtime",agentSettings:"openai-model",safeConfiguration:noSafeConfiguration},
 "anthropic-messages":{id:"anthropic-messages",provider:"anthropic",label:"Anthropic",catalogueLabel:"Anthropic",endpoint:"https://api.anthropic.com",authentication:"api-key",model:anthropicModel,capabilities:{asynchronous:false,cancellation:false},execution:"direct",agentSettings:"anthropic-messages",safeConfiguration:noSafeConfiguration},
};

export function getProviderConnectionType(value:string):ProviderConnectionType|undefined{return types[value as ProviderConnectionTypeId]}
export function requireProviderConnectionType(value:string):ProviderConnectionType{const type=getProviderConnectionType(value);if(!type)throw new Error("connection_unavailable");return type}
export const providerConnectionTypes=PROVIDER_CONNECTION_TYPE_IDS.map(id=>types[id]);
export function isExecutableGitProviderAdapter(value:string){return Boolean(getProviderConnectionType(value))}
export function usesOpenAIModelAgentSettings(policy:Pick<ProviderConnectionTypePolicy,"agentSettings">|undefined){return policy?.agentSettings==="openai-model"}
export function usesAnthropicMessagesAgentSettings(policy:Pick<ProviderConnectionTypePolicy,"agentSettings">|undefined){return policy?.agentSettings==="anthropic-messages"}
export function normalizeConnectionModel(policy:Pick<ProviderConnectionTypePolicy,"model">,model?:string){const value=model?.trim();if(policy.model.required&&!value)throw new Error("model_required");return policy.model.required&&value?{model:value}:{};}
export function connectionRequestModel(policy:Pick<ProviderConnectionTypePolicy,"model">,model:string){return normalizeConnectionModel(policy,model)}
