export const PROVIDER_CONNECTION_TYPE_IDS=["openai-responses","openai-agents"] as const;
export type ProviderConnectionTypeId=typeof PROVIDER_CONNECTION_TYPE_IDS[number];
export type ProviderAuthenticationKind="api-key"|"delegated-oauth";
export type ProviderExecutionPath="direct"|"adt-runtime";
export type ProviderAgentSettingsFamily="none"|"openai-model";
export type ProviderConnectionTypePolicy={
 id:string;provider:string;label:string;catalogueLabel:string;endpoint?:string;
 authentication:ProviderAuthenticationKind;model:{required:boolean;discovery:boolean;discoveryGuidance?:string};
 capabilities:{asynchronous:boolean;cancellation:boolean};execution:ProviderExecutionPath;
 agentSettings:ProviderAgentSettingsFamily;
};
export type ProviderConnectionType=ProviderConnectionTypePolicy&{id:ProviderConnectionTypeId};

const openAIModel={required:true,discovery:true,discoveryGuidance:"Search the models available to this authenticated OpenAI project."} as const;
const types:Record<ProviderConnectionTypeId,ProviderConnectionType>={
 "openai-responses":{id:"openai-responses",provider:"openai",label:"OpenAI Responses",catalogueLabel:"OpenAI Responses",endpoint:"https://api.openai.com/v1",authentication:"api-key",model:openAIModel,capabilities:{asynchronous:true,cancellation:true},execution:"direct",agentSettings:"openai-model"},
 "openai-agents":{id:"openai-agents",provider:"openai",label:"OpenAI Agents (ADT Runtime)",catalogueLabel:"OpenAI Agents / ADT Runtime",endpoint:"https://api.openai.com/v1",authentication:"api-key",model:openAIModel,capabilities:{asynchronous:false,cancellation:false},execution:"adt-runtime",agentSettings:"openai-model"},
};

export function getProviderConnectionType(value:string):ProviderConnectionType|undefined{return types[value as ProviderConnectionTypeId]}
export function requireProviderConnectionType(value:string):ProviderConnectionType{const type=getProviderConnectionType(value);if(!type)throw new Error("connection_unavailable");return type}
export const providerConnectionTypes=PROVIDER_CONNECTION_TYPE_IDS.map(id=>types[id]);
export function isExecutableGitProviderAdapter(value:string){return Boolean(getProviderConnectionType(value))}
export function usesOpenAIModelAgentSettings(policy:Pick<ProviderConnectionTypePolicy,"agentSettings">|undefined){return policy?.agentSettings==="openai-model"}
export function normalizeConnectionModel(policy:Pick<ProviderConnectionTypePolicy,"model">,model?:string){const value=model?.trim();if(policy.model.required&&!value)throw new Error("model_required");return policy.model.required&&value?{model:value}:{};}
export function connectionRequestModel(policy:Pick<ProviderConnectionTypePolicy,"model">,model:string){return normalizeConnectionModel(policy,model)}
