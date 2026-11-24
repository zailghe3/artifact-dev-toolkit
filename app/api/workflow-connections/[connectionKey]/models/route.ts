import {NextResponse} from "next/server";
import {z} from "zod";
import {requireApiRepositoryAccess} from "@/lib/auth";
import {noStoreHeaders} from "@/lib/auth-core";
import {readBoundedJson,workflowError} from "@/lib/workflow-http";
import {getProviderModelService} from "@/lib/workflow-services";
import {providerModelDiscoveryFailure,providerModelDiscoverySuccess} from "@/lib/provider-model-diagnostics";
import {createWorkflowConnectionDefinitionRepository} from "@/lib/workflow-services";
import {PROVIDER_CONNECTION_TYPE_IDS} from "@/lib/provider-connection-types";
import {savedProviderModelRequest} from "@/lib/provider-saved-model-discovery";
const input=z.object({connectionType:z.enum(PROVIDER_CONNECTION_TYPE_IDS),configuration:z.unknown().optional()}).strict();
function sameOrigin(request:Request){const origin=request.headers.get("origin");return !!origin&&origin===new URL(request.url).origin}
export async function POST(request:Request,{params}:{params:Promise<{connectionKey:string}>}){const started=Date.now(),auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;try{if(!sameOrigin(request))return NextResponse.json({code:"invalid_origin",error:"Request origin is invalid."},{status:403,headers:noStoreHeaders});const providerModelService=await getProviderModelService(auth.access.repositoryId);const {connectionType,configuration}=input.parse(await readBoundedJson(request,4096)),key=(await params).connectionKey,repository=createWorkflowConnectionDefinitionRepository(auth.access),{connection,safeConfiguration}=await savedProviderModelRequest(key,connectionType,configuration,repository),models=await providerModelService.listSaved(connection,connectionType,safeConfiguration);return providerModelDiscoverySuccess(connectionType,models,started)}catch(error){return providerModelDiscoveryFailure(error,started)??workflowError(error)}}
