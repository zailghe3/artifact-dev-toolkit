import { requireApiRepositoryAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import { isRuntimeServiceFailure } from "@/lib/runtime-service-client";
import { workflowRuntimeCommand } from "@/lib/workflow-services";
import { readBoundedJson, workflowError } from "@/lib/workflow-http";
import { toolDecisionSchema } from "@/adt-runtime/src/runtime-control-contract";

export async function GET(request:Request,{params}:{params:Promise<{runId:string}>}) {
  const auth=await requireApiRepositoryAccess(request);
  if(auth instanceof Response)return auth;
  try{
    const {runId}=await params;
    const result=await workflowRuntimeCommand({operation:"runs.tools",runId,repositoryId:auth.access.repositoryId,actor:auth.session.login});
    return Response.json(result,{headers:noStoreHeaders});
  }catch(error){return workflowError(error)}
}
export async function POST(request:Request,{params}:{params:Promise<{runId:string}>}) {
  const auth=await requireApiRepositoryAccess(request);
  if(auth instanceof Response)return auth;
  try{
    const {runId}=await params,decision=toolDecisionSchema.parse(await readBoundedJson(request,140000));
    const result=await workflowRuntimeCommand({operation:"runs.tools",runId,repositoryId:auth.access.repositoryId,actor:auth.session.login,decision});
    return Response.json(result,{headers:noStoreHeaders});
  }catch(error){
    const code=error instanceof Error?error.message:"";
    const forbidden=code==="permission_denied";
    if(isRuntimeServiceFailure(error)||code==="runtime_unavailable"||code==="run_not_found"||code==="definition_repository_unavailable")return workflowError(error);
    return Response.json({error:forbidden?"This tool action is not authorised.":"The tool decision is invalid, expired or no longer pending."},{status:forbidden?403:409,headers:noStoreHeaders});
  }
}
