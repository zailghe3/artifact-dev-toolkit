import {NextResponse} from "next/server";
import {requireApiRepositoryAccess} from "@/lib/auth";
import {noStoreHeaders} from "@/lib/auth-core";
import {diagnoseADTRuntimeExecutionPath} from "@/lib/workflow-services";
function sameOrigin(request:Request){const origin=request.headers.get("origin");return Boolean(origin&&origin===new URL(request.url).origin)}
export async function POST(request:Request){const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;if(!sameOrigin(request))return NextResponse.json({error:"Request origin is invalid."},{status:403,headers:noStoreHeaders});let value:unknown;try{value=await request.json()}catch{return NextResponse.json({error:"Request body is invalid."},{status:400,headers:noStoreHeaders})}if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length!==0)return NextResponse.json({error:"Request body is invalid."},{status:400,headers:noStoreHeaders});return NextResponse.json(await diagnoseADTRuntimeExecutionPath(),{headers:noStoreHeaders})}
