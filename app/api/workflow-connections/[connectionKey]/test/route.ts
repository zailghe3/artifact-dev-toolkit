import {NextResponse} from "next/server";
import {requireApiRepositoryAccess} from "@/lib/auth";
import {noStoreHeaders} from "@/lib/auth-core";
import {testWorkflowConnection} from "@/lib/workflow-connection-test";
import {getWorkflowAdapterRegistry,getWorkflowProviderConnectionStore} from "@/lib/workflow-services";

function sameOrigin(request:Request){const origin=request.headers.get("origin");return !!origin&&origin===new URL(request.url).origin;}
export async function POST(request:Request,{params}:{params:Promise<{connectionKey:string}>}){
 const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;
 if(!sameOrigin(request))return NextResponse.json({ok:false,category:"permission_denied",message:"Request origin is invalid."},{status:403,headers:noStoreHeaders});
 const {connectionKey}=await params;
 // Deliberately do not read the request body: every diagnostic input is server controlled.
 const result=await testWorkflowConnection(connectionKey,await getWorkflowProviderConnectionStore(auth.access),getWorkflowAdapterRegistry());
 return NextResponse.json(result.ok?{ok:true,message:"Connection successful.",output:result.outputText}:{ok:false,category:result.category,message:result.safeMessage},{headers:noStoreHeaders});
}
