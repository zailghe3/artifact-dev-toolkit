import {NextResponse} from "next/server";
import {requireApiRepositoryAccess} from "@/lib/auth";
import {noStoreHeaders} from "@/lib/auth-core";
import {workflowError} from "@/lib/workflow-http";
import {getWorkflowProviderConnectionMigrationService} from "@/lib/workflow-services";

export async function GET(request:Request,{params}:{params:Promise<{connectionKey:string}>}){const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;try{return NextResponse.json({migration:await(await getWorkflowProviderConnectionMigrationService(auth.access)).inspect((await params).connectionKey)},{headers:noStoreHeaders})}catch(error){return workflowError(error)}}
