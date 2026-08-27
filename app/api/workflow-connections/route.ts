import {NextResponse} from "next/server";
import {z} from "zod";
import {requireApiRepositoryAccess} from "@/lib/auth";
import {noStoreHeaders} from "@/lib/auth-core";
import {createWorkflowConnectionDefinitionRepository,getProviderCredentialVault,getWorkflowProviderConnectionStore,listWorkflowConnectionDescriptors} from "@/lib/workflow-services";
import {readBoundedJson,workflowError} from "@/lib/workflow-http";
import {validateOpenAIModel} from "@/lib/openai-models";
import {createTargetVaultConnection} from "@/lib/provider-vault-connection-creation";

export async function GET(request:Request){const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;return NextResponse.json({connections:await listWorkflowConnectionDescriptors(undefined,auth.access)},{headers:noStoreHeaders});}
const key=/^[a-z0-9]+(?:-[a-z0-9]+)*$/,input=z.object({connectionKey:z.string().max(80).regex(key),displayName:z.string().trim().min(1).max(120),adapter:z.enum(["openai-responses","openai-agents"]),model:z.string().trim().min(1).max(120),credential:z.string().min(1).max(8192)}).strict();
function sameOrigin(r:Request){const origin=r.headers.get("origin");return !!origin&&origin===new URL(r.url).origin;}

/** Reserve the collision-safe vault identity first, then issue exactly one Git mutation. */
export async function POST(request:Request){const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;try{if(!sameOrigin(request))return NextResponse.json({code:"invalid_origin",error:"Request origin is invalid."},{status:403,headers:noStoreHeaders});const body=input.parse(await readBoundedJson(request,10240)),store=await getWorkflowProviderConnectionStore(auth.access),vault=await getProviderCredentialVault(),repository=createWorkflowConnectionDefinitionRepository(auth.access);await createTargetVaultConnection(body,store,vault,repository,validateOpenAIModel);return NextResponse.json({connection:await store.getSafeDescriptor(body.connectionKey)},{status:201,headers:noStoreHeaders});}catch(error){return workflowError(error);}}
