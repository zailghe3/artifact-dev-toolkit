import { z } from "zod";
import { requireApiRepositoryAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import { workflowRuntimeCommand } from "@/lib/workflow-services";
import { readBoundedJson, workflowError } from "@/lib/workflow-http";

const bodySchema=z.object({approvalRequestId:z.string().uuid()}).strict();
export async function POST(request:Request,{params}:{params:Promise<{runId:string}>}) {
  const auth=await requireApiRepositoryAccess(request);
  if(auth instanceof Response)return auth;
  try{
    const {runId}=await params;
    const {approvalRequestId}=bodySchema.parse(await readBoundedJson(request,256));
    await workflowRuntimeCommand({operation:"runs.approval",runId,repositoryId:auth.access.repositoryId,approvalRequestId});
    return Response.json({runId,status:"approved",approvalRequestId},{headers:noStoreHeaders});
  }catch(error){return workflowError(error)}
}
