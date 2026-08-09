import {NextResponse} from "next/server";
import {requireApiRepositoryAccess} from "@/lib/auth";
import {noStoreHeaders} from "@/lib/auth-core";
import {getArtifacts} from "@/lib/artifacts";
import {searchWorkflowAgentPrompts} from "@/lib/workflow-agent-prompts";
import {mapOperationalError} from "@/lib/operational-errors";
export async function GET(request:Request){const authorization=await requireApiRepositoryAccess(request);if(authorization instanceof Response)return authorization;try{const query=new URL(request.url).searchParams.get("q")??"";return NextResponse.json({prompts:searchWorkflowAgentPrompts(await getArtifacts(authorization.access),query)},{headers:noStoreHeaders});}catch(error){const state=mapOperationalError(error);return NextResponse.json({error:"Artifact Library temporarily unavailable.",code:state.category},{status:state.status,headers:noStoreHeaders});}}
