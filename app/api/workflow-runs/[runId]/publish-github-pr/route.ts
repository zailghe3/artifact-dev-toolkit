import { z } from "zod";
import { requireApiRepositoryAccess } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/auth-core";
import { workflowRuntimeCommand } from "@/lib/workflow-services";
import { readBoundedJson, workflowError } from "@/lib/workflow-http";

const body=z.object({stepId:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),title:z.string().trim().min(1).max(256),body:z.string().max(65536),draft:z.boolean()}).strict();
export async function POST(request:Request,{params}:{params:Promise<{runId:string}>}) {
  const auth=await requireApiRepositoryAccess(request);
  if(auth instanceof Response)return auth;
  try{
    const {runId}=await params,input=body.parse(await readBoundedJson(request,70000));
    return Response.json(await workflowRuntimeCommand({operation:"runs.publish",runId,repositoryId:auth.access.repositoryId,...input}),{headers:noStoreHeaders});
  }catch(error){
    const code=error instanceof Error?error.message:"internal_error";
    if(code==="managed_codex_result_required"||code==="managed_task_has_no_changes"||code==="managed_publication_conflict"||code==="provider_publish_ambiguous")return Response.json({error:code},{status:409,headers:noStoreHeaders});
    return workflowError(error);
  }
}
