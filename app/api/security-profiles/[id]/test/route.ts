import {NextResponse} from "next/server";
import {requireApiRepositoryAccess} from "@/lib/auth";
import {noStoreHeaders} from "@/lib/auth-core";
import {workflowError} from "@/lib/workflow-http";
import {createSecurityProfileDefinitionRepository,getProviderCredentialVault,getWorkflowEnvironment} from "@/lib/workflow-services";
import {RemoteOpenAIAgentsRuntime,RemoteRuntimeFailure} from "@/lib/adt-runtime-client";
import {resolveRuntimeReleaseFreshness} from "@/lib/infrastructure-freshness-live";
import {securityProfileTestMessage} from "@/lib/security-profile-test-presentation";

const sourceFor=(code:string|undefined)=>code?.startsWith("adrian_")||code==="execution_failed"?"adrian":"adt-runtime";

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  const started=Date.now(),auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;
  try {
    const id=(await params).id,profile=await createSecurityProfileDefinitionRepository(auth.access).get(id);if(!profile)throw new Error("security_profile_missing");
    const vault=await getProviderCredentialVault(),binding=await vault.currentSecurityProfileCredentialBinding(auth.access.repositoryId,id,profile.definition.endpointUrl),credential=await vault.resolveSecurityProfileCredential(auth.access.repositoryId,binding.bindingId,profile.definition.endpointUrl),rawEnv=await getWorkflowEnvironment(),env=rawEnv as unknown as Record<string,string|undefined>,runtime=new RemoteOpenAIAgentsRuntime({baseUrl:env.ADT_RUNTIME_BASE_URL,authSecret:env.ADT_RUNTIME_AUTH_SECRET,wrappingPublicKey:env.ADT_RUNTIME_WRAPPING_PUBLIC_KEY});
    const result=await runtime.testSecurityProfile(profile.definition,credential);
    const freshness=resolveRuntimeReleaseFreshness(result),runtimeFreshness=freshness.state;
    return NextResponse.json({state:"ready",provider:"adrian",profileId:id,source:"adrian",stage:"ready",safeCode:"ready",policyMode:"block",runtimeRevision:result.runtimeRevision,runtimeFreshness,elapsedMs:Date.now()-started},{headers:noStoreHeaders});
  } catch(error) {
    if(error instanceof RemoteRuntimeFailure){
      const freshness=resolveRuntimeReleaseFreshness({runtimeRevision:error.runtimeRevision}),runtimeFreshness=freshness.state,safeCode=securitySafeCode(error),message=securityProfileTestMessage(safeCode,runtimeFreshness,error.securityDiagnostic?.httpStatus);
      const diagnostic=error.securityDiagnostic;
      return NextResponse.json({error:message,source:sourceFor(error.runtimeCode),stage:diagnostic?.stage??"runtime",safeCode,runtimeRevision:error.runtimeRevision,runtimeFreshness,elapsedMs:diagnostic?.elapsedMs??Date.now()-started,...(diagnostic?.httpStatus?{httpStatus:diagnostic.httpStatus}:{}),...(diagnostic?.websocketCloseCode?{websocketCloseCode:diagnostic.websocketCloseCode}:{}),...(diagnostic?.policyMode?{policyMode:diagnostic.policyMode}:{})},{status:503,headers:noStoreHeaders});
    }
    return workflowError(error);
  }
}

function securitySafeCode(error:RemoteRuntimeFailure){if(error.runtimeCode?.startsWith("adrian_"))return error.runtimeCode;if(error.runtimeCode==="runtime_authentication_failed")return "runtime_authentication_failed";if(error.runtimeCode==="protocol_incompatible")return "runtime_protocol_incompatible";if(error.runtimeCode==="wrapping_key_invalid")return "runtime_configuration_invalid";if(error.runtimeCode==="credential_invalid")return "runtime_wrapping_key_mismatch";if(error.runtimeCode==="capability_unavailable")return "runtime_capability_missing";if(error.runtimeCode==="runtime_unavailable"||error.category==="connection_unavailable")return "runtime_unreachable";return "security_unavailable"}
