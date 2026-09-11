import {NextResponse} from "next/server";
import {z} from "zod";
import {requireApiRepositoryAccess} from "@/lib/auth";
import {noStoreHeaders} from "@/lib/auth-core";
import {workflowLayoutSchema} from "@/lib/workflow-layout";
import {persistLayoutAgainstWorkflowRevision} from "@/lib/workflow-layout-persistence";
import {createWorkflowDefinitionRepository,createWorkflowLayoutRepository} from "@/lib/workflow-services";
import {readBoundedJson,workflowError} from "@/lib/workflow-http";

const saveSchema=z.object({layout:workflowLayoutSchema,fileSha:z.string().min(1).max(100).optional(),workflowFileSha:z.string().min(1).max(100)}).strict();

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;
 try{const {id}=await params,definitions=createWorkflowDefinitionRepository(auth.access);if(!await definitions.getWorkflow(id))return NextResponse.json({error:"Workflow not found",code:"not_found"},{status:404,headers:noStoreHeaders});const layout=await createWorkflowLayoutRepository(auth.access).getLayout(id);return NextResponse.json({layout:layout??null},{headers:noStoreHeaders});}catch(error){return workflowError(error);}
}

export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}){
 const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;
 try{const {id}=await params,body=saveSchema.parse(await readBoundedJson(request));if(body.layout.workflowId!==id)throw new Error("invalid_json");const definitions=createWorkflowDefinitionRepository(auth.access),layouts=createWorkflowLayoutRepository(auth.access),saved=await persistLayoutAgainstWorkflowRevision(definitions,layouts,body.layout,body.workflowFileSha,body.fileSha);return NextResponse.json(saved,{headers:noStoreHeaders});}catch(error){return workflowError(error);}
}
