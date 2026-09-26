import {NextResponse} from "next/server";
import {z} from "zod";
import {requireApiRepositoryAccess} from "@/lib/auth";
import {noStoreHeaders} from "@/lib/auth-core";
import {createWorkflowConnectionDefinitionRepository,getProviderCredentialVault,getWorkflowProviderConnectionStore,listWorkflowConnectionDescriptors} from "@/lib/workflow-services";
import {readBoundedJson,workflowError} from "@/lib/workflow-http";
import {providerModelService} from "@/lib/provider-model-service";
import {PROVIDER_CONNECTION_TYPE_IDS,requireProviderConnectionType} from "@/lib/provider-connection-types";
import {createApiKeyVaultConnection} from "@/lib/provider-api-key-connection-creation";
import {createConnectionForAuthentication} from "@/lib/provider-authentication-lifecycle";
import {createDelegatedVaultConnection} from "@/lib/provider-delegated-connection-creation";

export async function GET(request:Request){const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;return NextResponse.json({connections:await listWorkflowConnectionDescriptors(undefined,auth.access)},{headers:noStoreHeaders});}
const key=/^[a-z0-9]+(?:-[a-z0-9]+)*$/,input=z.object({connectionKey:z.string().max(80).regex(key),displayName:z.string().trim().min(1).max(120),adapter:z.enum(PROVIDER_CONNECTION_TYPE_IDS),model:z.string().trim().min(1).max(120).optional(),configuration:z.unknown().optional(),credential:z.string().min(1).max(8192).optional(),clientSecret:z.string().min(1).max(8192).optional()}).strict();
function sameOrigin(r:Request){const origin=r.headers.get("origin");return !!origin&&origin===new URL(r.url).origin;}

/** Dispatch authentication before reserving secrets or mutating Git. */
export async function POST(request:Request){const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;try{if(!sameOrigin(request))return NextResponse.json({code:"invalid_origin",error:"Request origin is invalid."},{status:403,headers:noStoreHeaders});const body=input.parse(await readBoundedJson(request,10240)),type=requireProviderConnectionType(body.adapter),store=await getWorkflowProviderConnectionStore(auth.access),vault=await getProviderCredentialVault(),repository=createWorkflowConnectionDefinitionRepository(auth.access);if(body.credential&&type.authentication!=="api-key"||body.clientSecret&&type.authentication!=="delegated-oauth")throw new Error("credential_source_invalid");await createConnectionForAuthentication(type,body.credential,async credential=>{await createApiKeyVaultConnection({...body,credential},store,vault,repository,(value,model,configuration)=>providerModelService.validate(body.adapter,value,model,configuration));return store},async()=>{if(!body.clientSecret)throw new Error("credential_required");await createDelegatedVaultConnection({connectionKey:body.connectionKey,displayName:body.displayName,adapter:body.adapter,configuration:body.configuration,clientSecret:body.clientSecret},store,vault,repository);return store});return NextResponse.json({connection:await store.getSafeDescriptor(body.connectionKey)},{status:201,headers:noStoreHeaders});}catch(error){return workflowError(error);}}
