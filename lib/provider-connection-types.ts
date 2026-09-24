export const PROVIDER_CONNECTION_TYPE_IDS=["openai-responses","openai-agents"] as const;
export type ProviderConnectionTypeId=typeof PROVIDER_CONNECTION_TYPE_IDS[number];

export type ProviderConnectionType={
 id:ProviderConnectionTypeId;provider:"openai";label:string;catalogueLabel:string;endpoint:string;
 authentication:"api-key";model:{required:true;discovery:true};
 capabilities:{asynchronous:boolean;cancellation:boolean};execution:"direct"|"adt-runtime";
};

const types:Record<ProviderConnectionTypeId,ProviderConnectionType>={
 "openai-responses":{id:"openai-responses",provider:"openai",label:"OpenAI Responses",catalogueLabel:"OpenAI Responses",endpoint:"https://api.openai.com/v1",authentication:"api-key",model:{required:true,discovery:true},capabilities:{asynchronous:true,cancellation:true},execution:"direct"},
 "openai-agents":{id:"openai-agents",provider:"openai",label:"OpenAI Agents (ADT Runtime)",catalogueLabel:"OpenAI Agents / ADT Runtime",endpoint:"https://api.openai.com/v1",authentication:"api-key",model:{required:true,discovery:true},capabilities:{asynchronous:false,cancellation:false},execution:"adt-runtime"},
};

export function getProviderConnectionType(value:string):ProviderConnectionType|undefined{return types[value as ProviderConnectionTypeId]}
export function requireProviderConnectionType(value:string):ProviderConnectionType{const type=getProviderConnectionType(value);if(!type)throw new Error("connection_unavailable");return type}
export const providerConnectionTypes=PROVIDER_CONNECTION_TYPE_IDS.map(id=>types[id]);
export function isExecutableGitProviderAdapter(value:string){return Boolean(getProviderConnectionType(value))}
