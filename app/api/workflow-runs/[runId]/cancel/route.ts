import { requireApiRepositoryAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import { workflowRuntimeCommand } from "@/lib/workflow-services";
import { workflowError } from "@/lib/workflow-http";

export async function POST(request:Request,{params}:{params:Promise<{runId:string}>}) {
  const auth=await requireApiRepositoryAccess(request);
  if(auth instanceof Response)return auth;
  try{
    const {runId}=await params;
    const status=await workflowRuntimeCommand({operation:"runs.cancel",runId,repositoryId:auth.access.repositoryId});
    return Response.json({runId,status},{headers:noStoreHeaders});
  }catch(error){return workflowError(error)}
}
