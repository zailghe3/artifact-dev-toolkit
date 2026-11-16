import {isSensitiveAdtTool} from "@/lib/adt-data-contract";
import {approvalInvocation,toolApprovalAuthority} from "@/lib/agent-tool-approval-authority";
import {getMcpPolicyAuthority,createToolDefinitionRepository,getProviderCredentialVault} from "@/lib/workflow-services";
import {NextResponse} from "next/server";
import {z} from "zod";
import {requireApiRepositoryAccess} from "@/lib/auth";
import {noStoreHeaders} from "@/lib/auth-core";
import {getWorkflowEnvironment,getWorkflowRunStorage} from "@/lib/workflow-services";
import {readBoundedJson} from "@/lib/workflow-http";
import {AgentJournal} from "@/lib/agent-journal";
import {agentWakeType} from "@/lib/agent-tool-wait";
import {requireToolRole,hasToolRole} from "@/lib/agent-tool-roles";
import type {WorkflowD1Database} from "@/lib/workflow-d1-storage";
const decision=z.discriminatedUnion("action",[
 z.object({action:z.literal("approval"),approvalId:z.string().uuid(),decisionId:z.string().uuid(),decision:z.enum(["approved","rejected"]),sensitiveDisclosureAcknowledged:z.literal(true).optional()}).strict(),
 z.object({action:z.literal("reconcile"),invocationId:z.string().regex(/^[a-f0-9]{64}$/),admissionId:z.string().uuid(),decisionId:z.string().uuid(),decision:z.enum(["success","not_executed","unresolved","terminate"]),basis:z.string().trim().min(1).max(4000),result:z.string().max(128000).optional()}).strict()
]);
async function context(request:Request,runId:string){const auth=await requireApiRepositoryAccess(request);if(auth instanceof Response)return auth;const detail=await(await getWorkflowRunStorage()).getRun(runId);if(!detail||detail.run.repositoryContext?.repositoryId!==auth.access.repositoryId)return NextResponse.json({error:"Run not found"},{status:404,headers:noStoreHeaders});const env=await getWorkflowEnvironment();return{auth,detail,env,journal:new AgentJournal(env.AUTH_SESSIONS_DB as unknown as WorkflowD1Database,undefined,env as unknown as Record<string,string|undefined>)}}
export async function GET(request:Request,{params}:{params:Promise<{runId:string}>}){
 const runId=z.string().uuid().parse((await params).runId),ctx=await context(request,runId);if(ctx instanceof Response)return ctx;
 const operator=hasToolRole(ctx.auth.session.login,"operator",ctx.env as unknown as Record<string,string>);
 const tools=(await ctx.journal.inspect(runId,operator,ctx.auth.session.login)).map(tool=>({...tool,approval:tool.approval?{...tool.approval,canReject:tool.approval.canDecide}:undefined}));
 for(const tool of tools)if(tool.approval?.canDecide)try{await toolApprovalAuthority({journal:ctx.journal,runId,invocationId:tool.id,decision:"approved",actor:ctx.auth.session.login,repositoryId:ctx.auth.access.repositoryId,repository:createToolDefinitionRepository(ctx.auth.access),policies:await getMcpPolicyAuthority(),vault:await getProviderCredentialVault()})}catch{tool.approval.canDecide=false}
 return NextResponse.json({tools,operator},{headers:noStoreHeaders});
}
export async function POST(request:Request,{params}:{params:Promise<{runId:string}>}){try{if(request.headers.get("origin")!==new URL(request.url).origin)return NextResponse.json({error:"Request origin is invalid."},{status:403,headers:noStoreHeaders});const runId=z.string().uuid().parse((await params).runId),ctx=await context(request,runId);if(ctx instanceof Response)return ctx;const body=decision.parse(await readBoundedJson(request,140000)),actor=ctx.auth.session.login.toLowerCase();if(body.action==="approval"){requireToolRole(actor,"approver",ctx.env as unknown as Record<string,string>);const invocationId=await approvalInvocation(ctx.journal,runId,body.approvalId),call=await ctx.journal.call(invocationId);if(body.decision==="approved"&&call&&isSensitiveAdtTool(call.tool_key)&&body.sensitiveDisclosureAcknowledged!==true)throw Error("permission_denied");const policyAuthority=await toolApprovalAuthority({journal:ctx.journal,runId,invocationId,decision:body.decision,actor,repositoryId:ctx.auth.access.repositoryId,repository:createToolDefinitionRepository(ctx.auth.access),policies:await getMcpPolicyAuthority(),vault:await getProviderCredentialVault()});await ctx.journal.decide({runId,approvalId:body.approvalId,decisionId:body.decisionId,decision:body.decision,actor,policyAuthority})}else{requireToolRole(actor,"operator",ctx.env as unknown as Record<string,string>);await ctx.journal.reconcile({runId,invocationId:body.invocationId,admissionId:body.admissionId,decisionId:body.decisionId,decision:body.decision,basis:body.basis,result:body.result,actor})}
 if(ctx.detail.run.workflowInstanceId)try{await(await ctx.env.AGENT_RUN_WORKFLOW.get(ctx.detail.run.workflowInstanceId)).sendEvent({type:agentWakeType(runId),payload:{runId}})}catch{return NextResponse.json({recorded:true,wakePending:true},{status:202,headers:noStoreHeaders})}
 return NextResponse.json({recorded:true},{headers:noStoreHeaders});
 }catch(error){const forbidden=error instanceof Error&&error.message==="permission_denied";return NextResponse.json({error:forbidden?"This tool action is not authorised.":"The tool decision is invalid, expired or no longer pending."},{status:forbidden?403:409,headers:noStoreHeaders})}}
