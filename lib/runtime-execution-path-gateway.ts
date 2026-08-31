import type {WorkflowD1Database} from "./workflow-d1-storage.ts";
import {verifyRuntimeDiagnosticAuthority,type RuntimeDiagnosticTarget} from "./langgraph-checkpoints.ts";

const headers={"cache-control":"no-store"};
export async function runtimeExecutionPathGateway(request:Request,target:RuntimeDiagnosticTarget,secret:string,db:WorkflowD1Database,queries:readonly string[]){
  let value:unknown;
  try{const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>256)throw new Error();value=JSON.parse(raw)}catch{return Response.json({ok:false,code:"invalid_request"},{status:400,headers})}
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length!==2||(value as Record<string,unknown>).operation!=="execution-path-diagnostic"||(value as Record<string,unknown>).target!==target)return Response.json({ok:false,code:"invalid_request"},{status:400,headers});
  const authorization=request.headers.get("authorization")??"",token=authorization.startsWith("Bearer ")?authorization.slice(7):"";
  if(!await verifyRuntimeDiagnosticAuthority(token,target,secret))return Response.json({ok:false,code:"authority_rejected"},{status:401,headers});
  try{for(const query of queries)await db.prepare(query).first();return Response.json({ok:true,authorityAccepted:true,backendAvailable:true},{headers})}catch{return Response.json({ok:false,code:"backend_unavailable",authorityAccepted:true,backendAvailable:false},{status:503,headers})}
}
