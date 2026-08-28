import {NextResponse} from "next/server";
import {z} from "zod";
import {requireApiRepositoryAccess} from "@/lib/auth";
import {noStoreHeaders} from "@/lib/auth-core";
import {workflowLayoutSchema} from "@/lib/workflow-layout";
import {DefinitionNotFoundError} from "@/lib/workflow-definition-repository";
import {createWorkflowDefinitionRepository,createWorkflowLayoutRepository} from "@/lib/workflow-services";
import {readBoundedJson,workflowError} from "@/lib/workflow-http";

const saveSchema=z.object({layout:workflowLayoutSchema,fileSha:z.string().min(1).max(100).optional()}).strict();

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;
 try{const {id}=await params,definitions=createWorkflowDefinitionRepository(auth.access);if(!await definitions.getWorkflow(id))return NextResponse.json({error:"Workflow not found",code:"not_found"},{status:404,headers:noStoreHeaders});const layout=await createWorkflowLayoutRepository(auth.access).getLayout(id);return NextResponse.json({layout:layout??null},{headers:noStoreHeaders});}catch(error){return workflowError(error);}
}

export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}){
 const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;
 try{const {id}=await params,body=saveSchema.parse(await readBoundedJson(request));if(body.layout.workflowId!==id)throw new Error("invalid_json");const definitions=createWorkflowDefinitionRepository(auth.access),workflow=await definitions.getWorkflow(id);if(!workflow)throw new DefinitionNotFoundError();const currentSteps=new Set(workflow.definition.steps.map(step=>step.id));if(Object.keys(body.layout.positions).some(stepId=>!currentSteps.has(stepId)))throw new Error("invalid_json");const layouts=createWorkflowLayoutRepository(auth.access),saved=body.fileSha?await layouts.updateLayout(body.layout,body.fileSha):await layouts.createLayout(body.layout);return NextResponse.json(saved,{headers:noStoreHeaders});}catch(error){return workflowError(error);}
}
