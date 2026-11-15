import {NextResponse} from "next/server";
import {z} from "zod";
import {requireApiRepositoryAccess} from "@/lib/auth";
import {noStoreHeaders} from "@/lib/auth-core";
import {getWorkflowRunStorage} from "@/lib/workflow-services";
import {readBoundedJson,workflowError} from "@/lib/workflow-http";
import {launchWorkflowRun} from "@/lib/workflow-run-admission";
const start=z.object({workflowId:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),initialInput:z.string().max(65536),idempotencyKey:z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/)}).strict();
export async function GET(request:Request){const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;try{const limit=Number(new URL(request.url).searchParams.get("limit")??25);return NextResponse.json({runs:await (await getWorkflowRunStorage()).listRuns(limit)},{headers:noStoreHeaders});}catch(error){return workflowError(error);}}
export async function POST(request:Request){const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;try{return await launchWorkflowRun(auth.access,start.parse(await readBoundedJson(request,70000)))}catch(error){return workflowError(error)}}
