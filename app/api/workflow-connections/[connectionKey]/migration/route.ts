import {NextResponse} from "next/server";
import {z} from "zod";
import {requireApiRepositoryAccess} from "@/lib/auth";
import {noStoreHeaders} from "@/lib/auth-core";
import {readBoundedJson,workflowError} from "@/lib/workflow-http";
import {getWorkflowProviderConnectionMigrationService} from "@/lib/workflow-services";

const retirement=z.object({confirmation:z.literal("RETIRE D1 FALLBACK"),repositoryRevision:z.string().min(1).max(200)}).strict();
function sameOrigin(request:Request){const origin=request.headers.get("origin");return !!origin&&origin===new URL(request.url).origin}

export async function GET(request:Request,{params}:{params:Promise<{connectionKey:string}>}){const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;try{return NextResponse.json({migration:await(await getWorkflowProviderConnectionMigrationService(auth.access)).inspect((await params).connectionKey)},{headers:noStoreHeaders})}catch(error){return workflowError(error)}}
export async function POST(request:Request,{params}:{params:Promise<{connectionKey:string}>}){const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;try{if(!sameOrigin(request))return NextResponse.json({code:"invalid_origin",error:"Request origin is invalid."},{status:403,headers:noStoreHeaders});const body=retirement.parse(await readBoundedJson(request,1024));return NextResponse.json({migration:await(await getWorkflowProviderConnectionMigrationService(auth.access)).retire((await params).connectionKey,body.repositoryRevision)},{headers:noStoreHeaders})}catch(error){return workflowError(error)}}
