import {NextResponse} from "next/server";
import {noStoreHeaders} from "@/lib/auth-core";
import {requireApiRepositoryAccess} from "@/lib/auth";
import {getFreshInfrastructureFreshnessSnapshot,invalidateInfrastructureFreshnessCache} from "@/lib/infrastructure-freshness-live";
import {redeployInfrastructure} from "@/lib/workflow-services";

export const dynamic="force-dynamic";
export async function POST(request:Request){
 const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;
 if(request.headers.get("origin")!==new URL(request.url).origin)return NextResponse.json({state:"rejected",message:"Request origin is invalid."},{status:403,headers:noStoreHeaders});
 let target:"runtime"|"runner";try{const value=await request.json() as Record<string,unknown>;if(!value||Array.isArray(value)||Object.keys(value).length!==1||(value.target!=="runtime"&&value.target!=="runner"))throw Error();target=value.target}catch{return NextResponse.json({state:"rejected",message:"Redeploy target is invalid."},{status:400,headers:noStoreHeaders})}
 try{const snapshot=await getFreshInfrastructureFreshnessSnapshot();if(snapshot.components[target].state!=="superseded")return NextResponse.json({state:"rejected",message:snapshot.components[target].state==="unknown"?"Update eligibility could not be confirmed.":"This component is not currently superseded."},{status:409,headers:noStoreHeaders});
 const result=await redeployInfrastructure(target);if(result.state==="accepted")invalidateInfrastructureFreshnessCache();return NextResponse.json(result,{status:result.state==="accepted"?202:result.state==="unsupported"?501:result.state==="ambiguous"?502:503,headers:noStoreHeaders})}catch{return NextResponse.json({state:"rejected",message:"Redeploy is temporarily unavailable."},{status:503,headers:noStoreHeaders})}
}
