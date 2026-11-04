import {getProviderConnectionType} from "./provider-connection-types.ts";
import type {ProviderModelService} from "./provider-model-service.ts";
import type {AgentProviderAdapter,ConnectionTestResult,FailureCategory} from "./workflow-adapter.ts";
import type {WorkflowProviderConnectionStore} from "./workflow-provider-connection-store.ts";

const unavailable:ConnectionTestResult={ok:false,category:"connection_unavailable",safeMessage:"Connection is not configured."};
const resolverMessages:Partial<Record<FailureCategory,string>>={authentication_failed:"Microsoft authentication failed; reconnect the account.",permission_denied:"Microsoft denied permission. Check tenant enablement and administrator consent.",rate_limited:"Microsoft identity service rate limited the request.",provider_unavailable:"Microsoft identity service is temporarily unavailable.",provider_timeout:"Microsoft identity service timed out.",malformed_response:"Microsoft identity service returned an invalid response.",configuration_invalid:"The delegated connection configuration is invalid."};

/** Resolves a credential transiently and invokes only an adapter's diagnostic capability. */
export async function testWorkflowConnection(connectionKey:string,store:WorkflowProviderConnectionStore,adapters:Map<string,AgentProviderAdapter>,models?:Pick<ProviderModelService,"validateForPolicy">):Promise<ConnectionTestResult>{
  let connection;
  try{connection=await store.resolveForExecution(connectionKey);}catch(error){const category=error&&typeof error==="object"&&"category" in error&&typeof error.category==="string"?error.category as FailureCategory:undefined;return category&&resolverMessages[category]?{ok:false,category,safeMessage:resolverMessages[category]!}:unavailable;}
  const type=getProviderConnectionType(connection.adapter);
  if(type?.model.location==="adt-runtime")try{if(!models)return unavailable;await models.validateForPolicy(type,connection.credential,connection.defaultModel,connection.providerConfiguration);return{ok:true,outputText:"Selected model is available through ADT Runtime."}}catch(error){const category=error&&typeof error==="object"&&"category" in error&&typeof error.category==="string"?error.category as FailureCategory:"connection_unavailable";return{ok:false,category,safeMessage:"Ollama model commissioning failed safely."}}
  const adapter=adapters.get(connection.adapter);
  if(!adapter?.testConnection)return unavailable;
  try{return await adapter.testConnection(connection);}catch{return{ok:false,category:"internal_error",safeMessage:"Connection test could not be completed."};}
}
