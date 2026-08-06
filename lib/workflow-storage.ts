import type { AgentDefinitionV1, WorkflowDefinitionV1 } from "./workflow-definitions.ts";
import type { ConnectionDescriptor } from "./workflow-connections.ts";
import type { FailureCategory } from "./workflow-adapter.ts";

export type RunStatus = "queued" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled";
export type StepStatus = "pending" | "starting" | "waiting_provider" | "succeeded" | "failed" | "cancelled";
export type StepAttempt = { runId: string; stepId: string; iteration: number; attempt: number; agentId: string; connectionKey: string; status: StepStatus; inputText?: string; outputText?: string; providerTaskId?: string; providerState?: string; startedAt?: string; completedAt?: string; failureCategory?: FailureCategory; safeFailureMessage?: string; retryable?: boolean };
export type WorkflowRun = { id: string; engineVersion: "1"; workflowId: string; workflowRevision: string; workflowSnapshot: WorkflowDefinitionV1; agentSnapshots: Record<string, AgentDefinitionV1>; connectionSnapshots: Record<string, ConnectionDescriptor>; initialInput: string; status: RunStatus; currentStepId?: string; transitionCount: number; workflowInstanceId?: string; finalOutput?: string; finalExternalUrl?: string; cancelRequestedAt?: string; createdAt: string; startedAt?: string; completedAt?: string; failureCode?: FailureCategory; failureMessage?: string; clientIdempotencyKey?: string };
export type RunDetail = { run: WorkflowRun; attempts: StepAttempt[] };
const terminalRuns = new Set<RunStatus>(["succeeded", "failed", "cancelled"]);

export interface WorkflowRunStorage {
  createRun(run: WorkflowRun): Promise<RunDetail>; getRun(id: string): Promise<RunDetail | undefined>; listRuns(limit?: number): Promise<WorkflowRun[]>;
  attachWorkflowInstance(id: string, instanceId: string): Promise<void>; claimStep(runId: string, stepId: string, inputText: string): Promise<StepAttempt>;
  persistProviderTask(runId: string, stepId: string, iteration: number, attempt: number, taskId: string): Promise<void>; completeStep(runId: string, stepId: string, iteration: number, attempt: number, output: string): Promise<void>;
  failStep(runId: string, stepId: string, iteration: number, attempt: number, failure: { category: FailureCategory; safeMessage: string; retryable: boolean }): Promise<void>;
  advance(runId: string, expectedStepId: string, nextStepId: string): Promise<void>; completeRun(runId: string, expectedStepId: string, output: string, externalUrl?: string): Promise<void>;
  failRun(runId: string, code: FailureCategory, message: string): Promise<void>; requestCancellation(runId: string): Promise<void>; cancelRun(runId: string): Promise<void>; createRetryAttempt(runId: string, stepId: string): Promise<StepAttempt>;
}

export class InMemoryWorkflowRunStorage implements WorkflowRunStorage {
  private runs = new Map<string, WorkflowRun>(); private attempts = new Map<string, StepAttempt[]>(); private idempotency = new Map<string, string>();
  private now() { return new Date().toISOString(); }
  async createRun(run: WorkflowRun) {
    if (run.clientIdempotencyKey && this.idempotency.has(run.clientIdempotencyKey)) return (await this.getRun(this.idempotency.get(run.clientIdempotencyKey)!))!;
    if (this.runs.has(run.id)) throw new Error("run_conflict");
    const first = run.workflowSnapshot.steps[0]; const stored = structuredClone(run); this.runs.set(run.id, stored);
    this.attempts.set(run.id, run.workflowSnapshot.steps.map((step) => ({ runId: run.id, stepId: step.id, iteration: 1, attempt: 1, agentId: step.agentId, connectionKey: run.agentSnapshots[step.agentId].connectionKey, status: "pending" })));
    if (run.clientIdempotencyKey) this.idempotency.set(run.clientIdempotencyKey, run.id); stored.currentStepId = first.id;
    return (await this.getRun(run.id))!;
  }
  async getRun(id: string) { const run = this.runs.get(id); return run ? structuredClone({ run, attempts: this.attempts.get(id) ?? [] }) : undefined; }
  async listRuns(limit = 25) { return [...this.runs.values()].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map((run) => structuredClone(run)); }
  private require(id: string) { const run = this.runs.get(id); if (!run) throw new Error("run_not_found"); return run; }
  private attempt(runId: string, stepId: string, iteration: number, attempt: number) { const value = this.attempts.get(runId)?.find((item) => item.stepId === stepId && item.iteration === iteration && item.attempt === attempt); if (!value) throw new Error("attempt_not_found"); return value; }
  async attachWorkflowInstance(id: string, instanceId: string) { const run=this.require(id); if (run.workflowInstanceId && run.workflowInstanceId !== instanceId) throw new Error("workflow_instance_conflict"); run.workflowInstanceId=instanceId; }
  async claimStep(runId: string, stepId: string, inputText: string) { const run=this.require(runId); if (terminalRuns.has(run.status) || run.currentStepId !== stepId) throw new Error("invalid_step_claim"); const values=this.attempts.get(runId)!.filter(a=>a.stepId===stepId); const item=values.at(-1)!; if (item.status === "starting" || item.status === "waiting_provider" || item.status === "succeeded") return structuredClone(item); if (item.status !== "pending") throw new Error("invalid_step_claim"); item.status="starting"; item.inputText=inputText; item.startedAt=this.now(); run.status="running"; run.startedAt??=this.now(); return structuredClone(item); }
  async persistProviderTask(r:string,s:string,i:number,a:number,taskId:string) { const item=this.attempt(r,s,i,a); if (item.providerTaskId && item.providerTaskId!==taskId) throw new Error("provider_task_conflict"); if (!item.providerTaskId && item.status!=="starting") throw new Error("invalid_attempt_state"); item.providerTaskId=taskId; item.providerState="pending"; item.status="waiting_provider"; }
  async completeStep(r:string,s:string,i:number,a:number,output:string) { const item=this.attempt(r,s,i,a); if (item.status==="succeeded") { if(item.outputText!==output) throw new Error("completion_conflict"); return; } if(!["starting","waiting_provider"].includes(item.status)) throw new Error("invalid_attempt_state"); item.status="succeeded"; item.outputText=output; item.providerState="completed"; item.completedAt=this.now(); }
  async failStep(r:string,s:string,i:number,a:number,f:{category:FailureCategory;safeMessage:string;retryable:boolean}) { const item=this.attempt(r,s,i,a); if(item.status==="failed") return; if(!["starting","waiting_provider"].includes(item.status)) throw new Error("invalid_attempt_state"); Object.assign(item,{status:"failed",failureCategory:f.category,safeFailureMessage:f.safeMessage,retryable:f.retryable,completedAt:this.now()}); }
  async advance(id:string,expected:string,next:string) { const run=this.require(id); if(run.status!=="running"||run.currentStepId!==expected) throw new Error("invalid_advancement"); const current=this.attempts.get(id)!.filter(a=>a.stepId===expected).at(-1)!; if(current.status!=="succeeded"||!run.workflowSnapshot.steps.some(s=>s.id===next)) throw new Error("invalid_advancement"); run.currentStepId=next; run.transitionCount++; }
  async completeRun(id:string,expected:string,output:string,externalUrl?:string) { const run=this.require(id); if(run.status==="succeeded") return; if(run.status!=="running"||run.currentStepId!==expected||this.attempts.get(id)!.filter(a=>a.stepId===expected).at(-1)?.status!=="succeeded") throw new Error("invalid_completion"); Object.assign(run,{status:"succeeded",finalOutput:output,finalExternalUrl:externalUrl,completedAt:this.now(),currentStepId:undefined}); }
  async failRun(id:string,code:FailureCategory,message:string) { const run=this.require(id); if(terminalRuns.has(run.status)) return; Object.assign(run,{status:"failed",failureCode:code,failureMessage:message,completedAt:this.now()}); }
  async requestCancellation(id:string) { const run=this.require(id); if(terminalRuns.has(run.status)) return; run.status="cancelling"; run.cancelRequestedAt??=this.now(); }
  async cancelRun(id:string) { const run=this.require(id); if(run.status!=="cancelling") throw new Error("invalid_cancellation"); run.status="cancelled"; run.completedAt=this.now(); for(const item of this.attempts.get(id)!) if(["pending","starting","waiting_provider"].includes(item.status)) item.status="cancelled"; }
  async createRetryAttempt(id:string,stepId:string) { const run=this.require(id); if(run.status!=="failed") throw new Error("invalid_retry"); const prior=this.attempts.get(id)!.filter(a=>a.stepId===stepId).at(-1); if(!prior||prior.status!=="failed"||prior.attempt>=3) throw new Error("invalid_retry"); const item={...prior,attempt:prior.attempt+1,status:"pending" as const,inputText:undefined,outputText:undefined,providerTaskId:undefined,providerState:undefined,startedAt:undefined,completedAt:undefined,failureCategory:undefined,safeFailureMessage:undefined,retryable:undefined}; this.attempts.get(id)!.push(item); Object.assign(run,{status:"queued",currentStepId:stepId,completedAt:undefined,failureCode:undefined,failureMessage:undefined}); return structuredClone(item); }
}

export function newWorkflowRun(input: { id: string; workflow: WorkflowDefinitionV1; revision: string; agents: AgentDefinitionV1[]; connections: ConnectionDescriptor[]; initialInput: string; clientIdempotencyKey?: string }): WorkflowRun {
  if (Buffer.byteLength(input.initialInput,"utf8") > 65536) throw new Error("initial_input_too_large");
  return { id:input.id,engineVersion:"1",workflowId:input.workflow.id,workflowRevision:input.revision,workflowSnapshot:structuredClone(input.workflow),agentSnapshots:Object.fromEntries(input.agents.map(a=>[a.id,structuredClone(a)])),connectionSnapshots:Object.fromEntries(input.connections.map(c=>[c.key,structuredClone(c)])),initialInput:input.initialInput,status:"queued",currentStepId:input.workflow.steps[0].id,transitionCount:0,createdAt:new Date().toISOString(),clientIdempotencyKey:input.clientIdempotencyKey };
}
