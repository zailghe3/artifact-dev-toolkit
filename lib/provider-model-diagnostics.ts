import {RemoteRuntimeFailure} from "./adt-runtime-client.ts";
import {NextResponse} from "next/server";
import {noStoreHeaders} from "./auth-core.ts";
import {OpenAIModelError} from "./openai-models.ts";
import {workflowError} from "./workflow-http.ts";
import {openAIModelDiagnostic} from "./provider-model-diagnostic-contract.ts";

export function providerModelSource(connectionType:string) {
  return connectionType.startsWith("openai-")?"openai":connectionType.startsWith("anthropic-")?"anthropic":connectionType==="ollama-chat"?"ollama":"provider";
}

export function providerModelDiscoveryFailure(error:unknown,started:number) {
  if(error instanceof RemoteRuntimeFailure)return NextResponse.json({source:"ollama",safeCode:error.runtimeCode??error.category,error:error.safeMessage,elapsedMs:Date.now()-started},{status:502,headers:noStoreHeaders});
  if(!(error instanceof OpenAIModelError))return undefined;
  const diagnostic=openAIModelDiagnostic(error.code,error.httpStatus),response=workflowError(error);
  return NextResponse.json({...diagnostic.body,elapsedMs:Date.now()-started},{status:response.status,headers:noStoreHeaders});
}

export function providerModelDiscoverySuccess(connectionType:string,models:string[],started:number) {
  return NextResponse.json({models,source:providerModelSource(connectionType),safeCode:"ok",elapsedMs:Date.now()-started},{headers:noStoreHeaders});
}
