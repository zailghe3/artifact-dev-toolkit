import {NextResponse} from "next/server";
import {z} from "zod";
import {requireApiRepositoryAccess} from "@/lib/auth";
import {noStoreHeaders} from "@/lib/auth-core";
import {createWorkflowConnectionDefinitionRepository,getProviderCredentialVault,getWorkflowProviderConnectionStore,listWorkflowConnectionDescriptors} from "@/lib/workflow-services";
import {readBoundedJson,workflowError} from "@/lib/workflow-http";
import {validateOpenAIModel} from "@/lib/openai-models";
import {connectionDefinitionSchema} from "@/lib/workflow-connection-definitions";

export async function GET(request:Request){const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;return NextResponse.json({connections:await listWorkflowConnectionDescriptors(undefined,auth.access)},{headers:noStoreHeaders});}
const key=/^[a-z0-9]+(?:-[a-z0-9]+)*$/,input=z.object({connectionKey:z.string().max(80).regex(key),displayName:z.string().trim().min(1).max(120),adapter:z.enum(["openai-responses","openai-agents"]),model:z.string().trim().min(1).max(120),credential:z.string().min(1).max(8192)}).strict();
function sameOrigin(r:Request){const origin=r.headers.get("origin");return !!origin&&origin===new URL(r.url).origin;}

/** Reserve the collision-safe vault identity first, then issue exactly one Git mutation. */
export async function POST(request:Request){const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;try{if(!sameOrigin(request))return NextResponse.json({code:"invalid_origin",error:"Request origin is invalid."},{status:403,headers:noStoreHeaders});const body=input.parse(await readBoundedJson(request,10240));await validateOpenAIModel(body.credential,body.model);const vault=await getProviderCredentialVault(),secretRef=await vault.create(body.credential),definition=connectionDefinitionSchema.parse({schemaVersion:1,id:body.connectionKey,name:body.displayName,runtime:body.adapter,provider:"openai",model:body.model,credential:{source:"adt-vault",secretRef}}),repository=createWorkflowConnectionDefinitionRepository(auth.access);if(!repository.createConnection)throw new Error("connection_repository_unavailable");try{await repository.createConnection(definition)}catch(error){if(error instanceof Error&&error.message==="connection_exists")await vault.delete(secretRef);throw error}const connection=await (await getWorkflowProviderConnectionStore(auth.access)).getSafeDescriptor(body.connectionKey);return NextResponse.json({connection},{status:201,headers:noStoreHeaders});}catch(error){return workflowError(error);}}
