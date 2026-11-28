import { z } from "zod";
import { requireApiRepositoryAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import { readBoundedJson, workflowError } from "@/lib/workflow-http";
import { createWorkflowConnectionDefinitionRepository, getProviderCredentialVault } from "@/lib/workflow-services";
import { mutateVaultCredential, recoverConnectionCredential } from "@/lib/provider-vault-connection-mutations";
import { providerRequiresCredential, requireProviderConnectionType } from "@/lib/provider-connection-types";

const input=z.object({credential:z.string().min(1).max(8192),repositoryRevision:z.string().min(1)}).strict();
const removeInput=z.object({repositoryRevision:z.string().min(1)}).strict();
async function context(request:Request,params:Promise<{connectionKey:string}>) {
  const auth=await requireApiRepositoryAccess(request);
  if(auth instanceof Response)return auth;
  const {connectionKey}=await params;
  const repository=createWorkflowConnectionDefinitionRepository(auth.access);
  const current=await repository.getConnection(connectionKey);
  if(!current)throw new Error("connection_unavailable");
  const type=requireProviderConnectionType(current.definition.runtime);
  if(!["api-key","optional-api-key"].includes(type.authentication)||!providerRequiresCredential(type,current.definition.configuration))throw new Error("authentication_lifecycle_unsupported");
  return { current, repository, vault:await getProviderCredentialVault(auth.access.repositoryId) };
}

export async function POST(request:Request,{params}:{params:Promise<{connectionKey:string}>}) {
  try{
    const value=await context(request,params);
    if(value instanceof Response)return value;
    const body=input.parse(await readBoundedJson(request,9216));
    await recoverConnectionCredential(value.current,body.repositoryRevision,body.credential,value.vault,value.repository);
    return Response.json({credentialConfigured:true},{headers:noStoreHeaders});
  }catch(error){return workflowError(error)}
}
export async function PUT(request:Request,{params}:{params:Promise<{connectionKey:string}>}) {
  try{
    const value=await context(request,params);
    if(value instanceof Response)return value;
    const body=input.parse(await readBoundedJson(request,9216));
    await mutateVaultCredential(value.current,body.repositoryRevision,value.vault,"replace",body.credential);
    return Response.json({credentialConfigured:true},{headers:noStoreHeaders});
  }catch(error){return workflowError(error)}
}
export async function DELETE(request:Request,{params}:{params:Promise<{connectionKey:string}>}) {
  try{
    const value=await context(request,params);
    if(value instanceof Response)return value;
    const body=removeInput.parse(await readBoundedJson(request,1024));
    await mutateVaultCredential(value.current,body.repositoryRevision,value.vault,"delete");
    return new Response(null,{status:204,headers:noStoreHeaders});
  }catch(error){return workflowError(error)}
}
