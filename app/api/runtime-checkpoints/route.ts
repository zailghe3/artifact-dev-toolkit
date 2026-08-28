import {NextResponse} from "next/server";
import {D1LangGraphCheckpointStore,parseCheckpointOperation,verifyCheckpointAuthority} from "@/lib/langgraph-checkpoints";
import {getWorkflowEnvironment} from "@/lib/workflow-services";
import type {WorkflowD1Database} from "@/lib/workflow-d1-storage";
export const runtime="nodejs";
const headers={"cache-control":"no-store"};
export async function POST(request:Request){try{const operation=parseCheckpointOperation(await request.json()),env=await getWorkflowEnvironment(),token=request.headers.get("authorization")?.replace(/^Bearer /,"")??"",secret=(env as unknown as Record<string,string>).ADT_CHECKPOINT_AUTHORITY_SECRET;if(!await verifyCheckpointAuthority(token,operation.threadId,secret))return NextResponse.json({ok:false,error:"checkpoint_authority_invalid"},{status:401,headers});const result=await new D1LangGraphCheckpointStore(env.AUTH_SESSIONS_DB as unknown as WorkflowD1Database).execute(operation.threadId,operation);return NextResponse.json({ok:true,result},{headers})}catch(error){const code=error instanceof Error?error.message:"checkpoint_persistence_unavailable",status=code==="checkpoint_state_conflicting"?409:code.includes("invalid")||code.includes("large")?400:503;return NextResponse.json({ok:false,error:code},{status,headers})}}
