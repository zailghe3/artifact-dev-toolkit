import {NextResponse} from "next/server";
import {z} from "zod";
import {requireApiRepositoryAccess} from "@/lib/auth";
import {readBoundedJson} from "@/lib/workflow-http";
import {getWorkflowEnvironment} from "@/lib/workflow-services";
import {approvalEventType,D1WorkflowApprovalStore} from "@/lib/workflow-approvals";
import type {WorkflowD1Database} from "@/lib/workflow-d1-storage";
import {workflowError} from "@/lib/workflow-http";
import {noStoreHeaders} from "@/lib/auth-core";
const bodySchema=z.object({approvalRequestId:z.string().uuid()}).strict();
export async function POST(request:Request,{params}:{params:Promise<{runId:string}>}){const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;try{const runId=z.string().uuid().parse((await params).runId),body=bodySchema.parse(await readBoundedJson(request,256)),env=await getWorkflowEnvironment(),store=new D1WorkflowApprovalStore(env.AUTH_SESSIONS_DB as unknown as WorkflowD1Database),result=await store.approve(runId,body.approvalRequestId),run=await (env.AUTH_SESSIONS_DB as unknown as WorkflowD1Database).prepare("SELECT workflow_instance_id FROM workflow_runs WHERE id=?").bind(runId).first<{workflow_instance_id:string}>();if(!run?.workflow_instance_id)throw new Error("workflow_instance_unavailable");await (await env.AGENT_RUN_WORKFLOW.get(run.workflow_instance_id)).sendEvent({type:approvalEventType(result.approval!.requestId),payload:{requestId:result.approval!.requestId}});return NextResponse.json({runId,status:"approved",approvalRequestId:result.approval!.requestId},{headers:noStoreHeaders});}catch(error){return workflowError(error)}}
