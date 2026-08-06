import type { AgentProviderAdapter, AdapterInvocation, AdapterResult, FailureCategory } from "./workflow-adapter.ts";
import type { ResolvedConnection } from "./workflow-connections.ts";
import type { WorkflowRunStorage, RunDetail } from "./workflow-storage.ts";

const MAX_TEXT_BYTES=262144, MAX_ATTEMPTS=3, MAX_RUN_MS=24*60*60*1000;
const transient = new Set<FailureCategory>(["rate_limited","provider_unavailable","provider_timeout"]);
export type RunnerBoundary = (label:string, operation:()=>Promise<void>)=>Promise<void>;
export class WorkflowRunner {
  private storage:WorkflowRunStorage; private adapters:Map<string,AgentProviderAdapter>; private resolve:(key:string)=>ResolvedConnection; private boundary:RunnerBoundary;
  constructor(storage:WorkflowRunStorage, adapters:Map<string,AgentProviderAdapter>, resolve:(key:string)=>ResolvedConnection, boundary:RunnerBoundary=async(_label,op)=>op()) { this.storage=storage;this.adapters=adapters;this.resolve=resolve;this.boundary=boundary; }
  private async cancellation(detail:RunDetail) { if(detail.run.status!=="cancelling"&&!detail.run.cancelRequestedAt)return false; const current=detail.attempts.filter(a=>a.stepId===detail.run.currentStepId).at(-1); if(current?.providerTaskId){const invocation=this.invocation(detail,current);const adapter=this.adapters.get(invocation.connection.adapter); if(adapter?.cancel) await adapter.cancel(current.providerTaskId,invocation);} await this.storage.cancelRun(detail.run.id); return true; }
  private invocation(detail:RunDetail,attempt:RunDetail["attempts"][number]):AdapterInvocation { const agent=detail.run.agentSnapshots[attempt.agentId]; return {runId:detail.run.id,stepId:attempt.stepId,iteration:attempt.iteration,attempt:attempt.attempt,idempotencyKey:`${detail.run.id}:${attempt.stepId}:${attempt.iteration}:${attempt.attempt}`,agentName:agent.name,masterPrompt:agent.masterPrompt,inputText:attempt.inputText??"",connection:this.resolve(attempt.connectionKey),providerOptions:agent.adapterOptions}; }
  async execute(runId:string):Promise<RunDetail> {
    for(;;){ let detail=await this.storage.getRun(runId); if(!detail)throw new Error("run_not_found"); if(["succeeded","failed","cancelled"].includes(detail.run.status))return detail; if(await this.cancellation(detail))return (await this.storage.getRun(runId))!;
      if(Date.now()-Date.parse(detail.run.createdAt)>MAX_RUN_MS){await this.storage.failRun(runId,"provider_timeout","The workflow run exceeded its time limit.");continue;}
      const currentRun=detail.run; const step=currentRun.workflowSnapshot.steps.find(s=>s.id===currentRun.currentStepId); if(!step){await this.storage.failRun(runId,"internal_error","The workflow cursor is invalid.");continue;}
      if(detail.run.transitionCount>=detail.run.workflowSnapshot.limits.maxStepExecutions){await this.storage.failRun(runId,"internal_error","The workflow transition limit was reached.");continue;}
      const index=currentRun.workflowSnapshot.steps.indexOf(step); const previous=index?detail.attempts.filter(a=>a.stepId===currentRun.workflowSnapshot.steps[index-1].id&&a.status==="succeeded").at(-1):undefined;
      const input=index===0?detail.run.initialInput:previous?.outputText; if(input===undefined){await this.storage.failRun(runId,"internal_error","The previous step output is unavailable.");continue;} if(Buffer.byteLength(input,"utf8")>MAX_TEXT_BYTES){await this.storage.failRun(runId,"output_too_large","The step input exceeds the allowed size.");continue;}
      let attempt=detail.attempts.filter(a=>a.stepId===step.id).at(-1)!; if(attempt.status==="pending")attempt=await this.storage.claimStep(runId,step.id,input);
      detail=(await this.storage.getRun(runId))!; if(await this.cancellation(detail))continue; const invocation=this.invocation(detail,attempt), adapter=this.adapters.get(invocation.connection.adapter); if(!adapter){await this.storage.failRun(runId,"configuration_invalid","The configured adapter is unavailable.");continue;}
      let result: AdapterResult | Awaited<ReturnType<AgentProviderAdapter["check"]>>;
      if(attempt.status==="succeeded"){result={state:"completed" as const,outputText:attempt.outputText??""};}
      else if(attempt.providerTaskId){result=await adapter.check(attempt.providerTaskId,invocation);}
      else {const started=await adapter.start(invocation);result=started;if(started.state==="pending"){const taskId=started.taskId;await this.boundary("persist-provider-task",()=>this.storage.persistProviderTask(runId,step.id,attempt.iteration,attempt.attempt,taskId));}}
      detail=(await this.storage.getRun(runId))!; if(await this.cancellation(detail))continue;
      if(result.state==="pending"){await this.boundary("wait-provider",async()=>{});continue;}
      if(result.state==="failed"){await this.storage.failStep(runId,step.id,attempt.iteration,attempt.attempt,{category:result.category,safeMessage:result.safeMessage,retryable:result.retryable}); if(result.retryable&&transient.has(result.category)&&attempt.attempt<MAX_ATTEMPTS){await this.storage.failRun(runId,result.category,result.safeMessage);await this.storage.createRetryAttempt(runId,step.id);continue;} await this.storage.failRun(runId,result.category,result.safeMessage);continue;}
      if(Buffer.byteLength(result.outputText,"utf8")>MAX_TEXT_BYTES){await this.storage.failStep(runId,step.id,attempt.iteration,attempt.attempt,{category:"output_too_large",safeMessage:"The provider output exceeds the allowed size.",retryable:false});await this.storage.failRun(runId,"output_too_large","The provider output exceeds the allowed size.");continue;}
      await this.boundary("complete-step",()=>this.storage.completeStep(runId,step.id,attempt.iteration,attempt.attempt,result.outputText));
      if(step.onSuccess.type==="complete")await this.boundary("complete-run",()=>this.storage.completeRun(runId,step.id,result.outputText,result.externalUrl)); else {const nextStepId=detail.run.workflowSnapshot.steps[index+1].id;await this.boundary("advance",()=>this.storage.advance(runId,step.id,nextStepId));}
    }
  }
}
