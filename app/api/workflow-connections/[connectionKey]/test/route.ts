import {NextResponse} from "next/server";
import {requireApiRepositoryAccess} from "@/lib/auth";
import {noStoreHeaders} from "@/lib/auth-core";
import {workflowError} from "@/lib/workflow-http";
import {getWorkflowProviderConnectionStore} from "@/lib/workflow-services";

export async function POST(request:Request,{params}:{params:Promise<{connectionKey:string}>}){
 const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;
 const {connectionKey}=await params;
 // Deliberately do not read the request body: every diagnostic input is server controlled.
 try {
 const result=await (await getWorkflowProviderConnectionStore(auth.access)).testConnection(connectionKey);
 return NextResponse.json(result.ok?{ok:true,message:"Connection successful.",output:result.outputText}:{ok:false,category:result.category,message:result.safeMessage},{headers:noStoreHeaders});
 } catch(error) { return workflowError(error); }
}
