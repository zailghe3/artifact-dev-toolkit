import type {AgentProviderAdapter,ConnectionTestResult} from "./workflow-adapter.ts";
import type {WorkflowProviderConnectionStore} from "./workflow-provider-connection-store.ts";

const unavailable:ConnectionTestResult={ok:false,category:"connection_unavailable",safeMessage:"Connection is not configured."};

/** Resolves a credential transiently and invokes only an adapter's diagnostic capability. */
export async function testWorkflowConnection(connectionKey:string,store:WorkflowProviderConnectionStore,adapters:Map<string,AgentProviderAdapter>):Promise<ConnectionTestResult>{
  let connection;
  try{connection=await store.resolveCredential(connectionKey);}catch{return unavailable;}
  const adapter=adapters.get(connection.adapter);
  if(!adapter?.testConnection)return unavailable;
  try{return await adapter.testConnection(connection);}catch{return{ok:false,category:"internal_error",safeMessage:"Connection test could not be completed."};}
}
