import {NextResponse} from "next/server";
import {checkpointGatewayFailureCode,D1LangGraphCheckpointStore,parseCheckpointOperation,verifyCheckpointAuthority} from "@/lib/langgraph-checkpoints";
import {getWorkflowEnvironment} from "@/lib/workflow-services";
import type {WorkflowD1Database} from "@/lib/workflow-d1-storage";
import {readRuntimeGatewayRequest} from "@/lib/runtime-gateway-request";
import {D1WorkflowRunStorage} from "@/lib/workflow-d1-storage";
import {requireCurrentCheckpointRun} from "@/lib/runtime-checkpoint-access";
import {isRuntimeExecutionPathEnvelope,runtimeExecutionPathGateway} from "@/lib/runtime-execution-path-gateway";
export const runtime="nodejs";
const headers={"cache-control":"no-store"};
export async function POST(request:Request){try{const value=await readRuntimeGatewayRequest(request,"checkpoint"),env=await getWorkflowEnvironment(),token=request.headers.get("authorization")?.replace(/^Bearer /,"")??"",secret=(env as unknown as Record<string,string>).ADT_INTERNAL_AUTHORITY_SECRET;if(isRuntimeExecutionPathEnvelope(value))return runtimeExecutionPathGateway(request,value,"checkpoint",secret,env.AUTH_SESSIONS_DB as unknown as WorkflowD1Database);const operation=parseCheckpointOperation(value);if(!await verifyCheckpointAuthority(token,operation.threadId,secret))return NextResponse.json({ok:false,error:"checkpoint_authority_invalid"},{status:401,headers});const db=env.AUTH_SESSIONS_DB as unknown as WorkflowD1Database;await requireCurrentCheckpointRun(new D1WorkflowRunStorage(db),operation.threadId);const result=await new D1LangGraphCheckpointStore(db).execute(operation.threadId,operation);return NextResponse.json({ok:true,result},{headers})}catch(error){const code=checkpointGatewayFailureCode(error),status=code==="checkpoint_authority_invalid"?401:code==="checkpoint_state_conflicting"?409:code==="checkpoint_persistence_unavailable"?503:400;return NextResponse.json({ok:false,error:code},{status,headers})}}
