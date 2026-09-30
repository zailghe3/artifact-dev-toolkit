import {NextResponse} from "next/server";
import {requireApiRepositoryAccess} from "@/lib/auth";
import {noStoreHeaders} from "@/lib/auth-core";
import {workflowError} from "@/lib/workflow-http";
import {createSecurityProfileDefinitionRepository,getProviderCredentialVault,getWorkflowEnvironment} from "@/lib/workflow-services";
import {RemoteOpenAIAgentsRuntime,RemoteRuntimeFailure} from "@/lib/adt-runtime-client";
import {resolveLiveComponentFreshness} from "@/lib/infrastructure-freshness-live";

const sourceFor=(code:string|undefined)=>code?.startsWith("adrian_")||code==="execution_failed"?"adrian":"adt-runtime";

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  const started=Date.now(),auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;
  try {
    const id=(await params).id,profile=await createSecurityProfileDefinitionRepository(auth.access).get(id);if(!profile)throw new Error("security_profile_missing");
    const vault=await getProviderCredentialVault(),binding=await vault.currentSecurityProfileCredentialBinding(auth.access.repositoryId,id,profile.definition.endpointUrl),credential=await vault.resolveSecurityProfileCredential(auth.access.repositoryId,binding.bindingId,profile.definition.endpointUrl),rawEnv=await getWorkflowEnvironment(),env=rawEnv as unknown as Record<string,string|undefined>,runtime=new RemoteOpenAIAgentsRuntime({baseUrl:env.ADT_RUNTIME_BASE_URL,authSecret:env.ADT_RUNTIME_AUTH_SECRET,wrappingPublicKey:env.ADT_RUNTIME_WRAPPING_PUBLIC_KEY});
    const result=await runtime.testSecurityProfile(profile.definition,credential);
    const freshness=await resolveLiveComponentFreshness("runtime",result.runtimeRevision),runtimeFreshness=freshness.state;
    return NextResponse.json({state:"ready",provider:"adrian",profileId:id,source:"adrian",safeCode:"ready",runtimeRevision:result.runtimeRevision,runtimeFreshness,runtimeSourceHeadRevision:freshness.sourceHeadRevision,elapsedMs:Date.now()-started},{headers:noStoreHeaders});
  } catch(error) {
    if(error instanceof RemoteRuntimeFailure){
      const freshness=await resolveLiveComponentFreshness("runtime",error.runtimeRevision),runtimeFreshness=freshness.state,safeCode=securitySafeCode(error),message=securityMessage(safeCode,runtimeFreshness);
      return NextResponse.json({error:message,source:sourceFor(error.runtimeCode),safeCode,runtimeRevision:error.runtimeRevision,runtimeFreshness,runtimeSourceHeadRevision:freshness.sourceHeadRevision,elapsedMs:Date.now()-started},{status:503,headers:noStoreHeaders});
    }
    return workflowError(error);
  }
}

function securitySafeCode(error:RemoteRuntimeFailure){if(error.runtimeCode==="runtime_authentication_failed")return "runtime_authentication_failed";if(error.runtimeCode==="protocol_incompatible")return "runtime_protocol_incompatible";if(error.runtimeCode==="wrapping_key_invalid")return "runtime_configuration_invalid";if(error.runtimeCode==="credential_invalid")return "runtime_wrapping_key_mismatch";if(error.runtimeCode==="capability_unavailable")return "runtime_capability_missing";if(error.runtimeCode==="runtime_unavailable"||error.category==="connection_unavailable")return "runtime_unreachable";if(error.runtimeCode==="adrian_initialization_failed")return "adrian_initialization_failed";if(error.runtimeCode==="adrian_policy_unavailable")return "adrian_policy_unavailable";return "security_unavailable"}
function securityMessage(code:string,freshness:string){if(code==="runtime_capability_missing")return `ADT Runtime does not support Adrian Security Profile testing.${freshness==="superseded"?" Runtime update required.":""}`;if(code==="runtime_unreachable")return "ADT Runtime is unavailable.";if(code==="runtime_authentication_failed")return "ADT Runtime authentication failed.";if(code==="runtime_protocol_incompatible")return "ADT Runtime protocol is incompatible.";if(code==="runtime_configuration_invalid")return "ADT Runtime wrapping key configuration is invalid.";if(code==="runtime_wrapping_key_mismatch")return "ADT Runtime credential wrapping key does not match.";if(code==="adrian_initialization_failed")return "Security enforcement is unavailable. Adrian initialization failed.";if(code==="adrian_policy_unavailable")return "Security enforcement is unavailable. Adrian policy readiness could not be established.";return "Security enforcement is unavailable."}
