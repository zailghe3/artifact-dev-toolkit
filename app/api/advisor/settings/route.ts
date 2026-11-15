import {z} from "zod";
import {requireApiRepositoryAccess} from "@/lib/auth";
import {noStoreHeaders} from "@/lib/auth-core";
import {advisorSettingsSchema} from "@/lib/advisor-policy";
import {getAdvisorSettingsStore} from "@/lib/advisor-services";
import {validateAdvisorSelection} from "@/lib/advisor-configuration";
import {validateAdvisorDependencies} from "@/lib/advisor-dependencies";
import {createWorkflowDefinitionRepository,listWorkflowConnectionIdentityDescriptors} from "@/lib/workflow-services";
import {validateAdvisorOverrideModel} from "@/lib/workflow-run-admission";
import {readBoundedJson,workflowError} from "@/lib/workflow-http";
const input=z.object({settings:advisorSettingsSchema,revision:z.number().int().min(0)}).strict();
export async function GET(request:Request){const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;try{return Response.json(await (await getAdvisorSettingsStore()).get(auth.access.repositoryId),{headers:noStoreHeaders})}catch(error){return workflowError(error)}}
export async function PUT(request:Request){
  const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;
  try{
    if(request.headers.get("origin")!==new URL(request.url).origin)throw new Error("invalid_origin");
    const body=input.parse(await readBoundedJson(request,4096)),connections=await listWorkflowConnectionIdentityDescriptors(auth.access);
    await validateAdvisorSelection(body.settings,createWorkflowDefinitionRepository(auth.access),connections,agents=>validateAdvisorDependencies(auth.access,agents));
    await validateAdvisorOverrideModel(body.settings,connections,auth.access);
    return Response.json(await (await getAdvisorSettingsStore()).save(auth.access.repositoryId,body.settings,body.revision),{headers:noStoreHeaders});
  }catch(error){return workflowError(error)}
}
