import {z} from "zod";
import {requireApiRepositoryAccess} from "@/lib/auth";
import {getAdvisorSettingsStore} from "@/lib/advisor-services";
import {launchWorkflowRun} from "@/lib/workflow-run-admission";
import {readBoundedJson,workflowError} from "@/lib/workflow-http";
const input=z.object({initialInput:z.string().trim().min(1).max(65536),idempotencyKey:z.string().uuid()}).strict();
export async function POST(request:Request){
  const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;
  try{
    if(request.headers.get("origin")!==new URL(request.url).origin)throw new Error("invalid_origin");
    const body=input.parse(await readBoundedJson(request,70000)),{settings}=await (await getAdvisorSettingsStore()).get(auth.access.repositoryId);
    if(!settings.workflowId)throw new Error("advisor_workflow_required");
    return await launchWorkflowRun(auth.access,{...body,workflowId:settings.workflowId},settings);
  }catch(error){return workflowError(error)}
}
