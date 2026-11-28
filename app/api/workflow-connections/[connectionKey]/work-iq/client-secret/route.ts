import {recoverConnectionCredential} from "@/lib/provider-vault-connection-mutations";
import {NextResponse} from "next/server";import {z} from "zod";import {requireApiRepositoryAccess} from "@/lib/auth";import {noStoreHeaders} from "@/lib/auth-core";import {createWorkflowConnectionDefinitionRepository,getProviderCredentialVault,workflowRuntimeCommand} from "@/lib/workflow-services";import {createWorkIqPrivateBundle} from "@/lib/work-iq-auth";import {readBoundedJson,workflowError} from "@/lib/workflow-http";
const input=z.object({clientSecret:z.string().min(1).max(8192),repositoryRevision:z.string().min(1)}).strict();
export async function PUT(request:Request,{params}:{params:Promise<{connectionKey:string}>}){const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;try{const body=input.parse(await readBoundedJson(request,9216)),key=(await params).connectionKey,repository=createWorkflowConnectionDefinitionRepository(auth.access),current=await repository.getConnection(key);if(!current||current.definition.runtime!=="work-iq-rest")throw new Error("connection_unavailable");if(body.repositoryRevision!==current.fileSha)throw new Error("connection_revision_conflict");try {
 await workflowRuntimeCommand({operation:"work-iq",method:"updateClientSecret",repositoryId:auth.access.repositoryId,arguments:[current.definition.credential!.secretRef,body.clientSecret]});
}catch(error){
 if(!(error instanceof Error)||error.message!=="vault_secret_unavailable")throw error;
 const vault=await getProviderCredentialVault(auth.access.repositoryId);
 await recoverConnectionCredential(current,body.repositoryRevision,createWorkIqPrivateBundle(body.clientSecret),vault,repository);
}
return NextResponse.json({ok:true},{headers:noStoreHeaders})}catch(error){return workflowError(error)}}
