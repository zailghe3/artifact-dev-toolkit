import {NextResponse} from "next/server";
import {requireApiRepositoryAccess} from "@/lib/auth";
import {noStoreHeaders} from "@/lib/auth-core";
import {readBoundedJson,workflowError} from "@/lib/workflow-http";
import {getWorkflowProviderConnectionMigrationService} from "@/lib/workflow-services";
import {z} from "zod";

export async function GET(request:Request,{params}:{params:Promise<{connectionKey:string}>}){const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;try{return NextResponse.json({migration:await(await getWorkflowProviderConnectionMigrationService(auth.access)).inspect((await params).connectionKey)},{headers:noStoreHeaders})}catch(error){return workflowError(error)}}

function sameOrigin(r:Request){const origin=r.headers.get("origin");return !!origin&&origin===new URL(r.url).origin;}
const input=z.object({expectedSource:z.enum(["legacy-d1","cloudflare-binding"]),repositoryRevision:z.string().min(1).max(200).optional(),sourceVersion:z.string().min(1).max(200).optional()}).strict();
export async function POST(request:Request,{params}:{params:Promise<{connectionKey:string}>}){const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;try{if(!sameOrigin(request))return NextResponse.json({code:"invalid_origin",error:"Request origin is invalid."},{status:403,headers:noStoreHeaders});const body=input.parse(await readBoundedJson(request,1024));return NextResponse.json({migration:await(await getWorkflowProviderConnectionMigrationService(auth.access)).migrate((await params).connectionKey,body)},{headers:noStoreHeaders})}catch(error){return workflowError(error)}}
