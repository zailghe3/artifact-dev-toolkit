import type {WorkflowD1Database} from "./workflow-d1-storage.ts";
import {verifyRuntimeDiagnosticAuthority,type RuntimeDiagnosticTarget} from "./langgraph-checkpoints.ts";

const headers={"cache-control":"no-store"};
const probes:Record<RuntimeDiagnosticTarget,readonly string[]>={checkpoint:["SELECT 1 FROM langgraph_checkpoints LIMIT 1","SELECT 1 FROM langgraph_checkpoint_writes LIMIT 1"],"graph-node":["SELECT 1 FROM workflow_runs LIMIT 1","SELECT 1 FROM workflow_step_attempts LIMIT 1"],"artifact-search":["SELECT 1 FROM workflow_runs LIMIT 1"]};
export function isRuntimeExecutionPathEnvelope(value:unknown){return Boolean(value&&typeof value==="object"&&!Array.isArray(value)&&(value as Record<string,unknown>).operation==="execution-path-diagnostic")}
export async function runtimeExecutionPathGateway(request:Request,value:unknown,target:RuntimeDiagnosticTarget,secret:string,db:WorkflowD1Database){
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length!==2||(value as Record<string,unknown>).operation!=="execution-path-diagnostic"||(value as Record<string,unknown>).target!==target)return Response.json({ok:false,code:"invalid_request"},{status:400,headers});
  const authorization=request.headers.get("authorization")??"",token=authorization.startsWith("Bearer ")?authorization.slice(7):"";
  if(!await verifyRuntimeDiagnosticAuthority(token,target,secret))return Response.json({ok:false,code:"authority_rejected"},{status:401,headers});
  try{for(const query of probes[target])await db.prepare(query).first();return Response.json({ok:true,authorityAccepted:true,backendAvailable:true},{headers})}catch{return Response.json({ok:false,code:"backend_unavailable",authorityAccepted:true,backendAvailable:false},{status:503,headers})}
}
