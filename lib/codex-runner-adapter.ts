import type {AdapterInvocation,AgentProviderAdapter,FailureCategory} from "./workflow-adapter.ts";
import {codexRunnerOptionsSchema} from "./workflow-adapter.ts";
import type {ConnectionDescriptor} from "./workflow-connections.ts";
import {gatewayFromConnection,RunnerGatewayError,type RunnerJob,type RunnerJobFailureReason} from "./codex-runner-workflow-gateway.ts";
type ClassifiedFailure=Error&{category:FailureCategory;safeMessage?:string;transportDiagnostics?:import("./workflow-adapter.ts").ProviderTransportDiagnostics};
const failure=(category:FailureCategory,safeMessage?:string,transportDiagnostics?:import("./workflow-adapter.ts").ProviderTransportDiagnostics):ClassifiedFailure=>Object.assign(new Error(category),{category,safeMessage,transportDiagnostics});
const terminal:Record<RunnerJobFailureReason,{category:FailureCategory;message:string}>={
 authentication_failed:{category:"authentication_failed",message:"Codex authentication is unavailable."},
 runner_restarted:{category:"provider_rejected",message:"The Runner restarted while the Codex job was active. Inspect the persistent workspace before retrying manually."},
 thread_start_failed:{category:"provider_rejected",message:"Codex could not start a thread in the configured environment."},
 turn_start_failed:{category:"provider_rejected",message:"Codex created the thread but could not start the turn."},
 turn_failed:{category:"provider_rejected",message:"The Codex turn failed before producing a usable final response."},
 interaction_required:{category:"provider_rejected",message:"Codex requested an interaction or approval that the unattended Runner does not permit."},
 output_too_large:{category:"output_too_large",message:"The provider output exceeded the allowed size."},
 timeout:{category:"provider_timeout",message:"The Codex job timed out. Inspect the persistent workspace before retrying manually."},
 internal_error:{category:"provider_rejected",message:"The Codex job failed because of an internal Runner error."}
};
export class CodexRunnerAdapter implements AgentProviderAdapter{
 readonly kind="codex-runner";
 async validateConnection(value:ConnectionDescriptor){return value.adapter===this.kind&&value.enabled?{ok:true as const}:{ok:false as const,safeMessage:"The Codex Runner connection is unavailable."}}
 private gateway(invocation:AdapterInvocation){if(!invocation.connection.enabled||invocation.connection.adapter!==this.kind)throw failure("connection_unavailable");return gatewayFromConnection(invocation.connection)}
 private result(job:RunnerJob):Awaited<ReturnType<AgentProviderAdapter["check"]>>{if(job.state==="queued"||job.state==="running")return{state:"pending",pollAfterMs:3000};if(job.state==="completed")return{state:"completed",outputText:job.outputText};if(job.state==="cancelled")return{state:"failed",category:"cancelled",retryable:false,safeMessage:"The Codex job was cancelled."};if(job.state==="failed"){const mapped=terminal[job.reason];return{state:"failed",category:mapped.category,retryable:false,safeMessage:mapped.message}}return{state:"failed",category:"internal_error",retryable:false,safeMessage:"The Codex job did not complete."}}
 async start(invocation:AdapterInvocation){const options=codexRunnerOptionsSchema.parse(invocation.providerOptions),prompt=`${invocation.masterPrompt}\n\nTask:\n\n${invocation.inputText}`;try{const job=await this.gateway(invocation).start({idempotencyKey:invocation.idempotencyKey,prompt,...options});if(job.state==="queued"||job.state==="running")return{state:"pending" as const,taskId:job.jobId,pollAfterMs:3000};if(job.state==="completed")return{state:"completed" as const,outputText:job.outputText};const result=this.result(job);if(result.state==="failed")throw failure(result.category,result.safeMessage)}catch(error){throw this.map(error)}throw failure("internal_error")}
 async check(taskId:string,invocation:AdapterInvocation){try{return this.result(await this.gateway(invocation).get(taskId))}catch(error){if(error instanceof RunnerGatewayError&&["runner_unavailable","invalid_response"].includes(error.code))return{state:"pending" as const,pollAfterMs:5000,providerState:"runner_status_temporarily_unavailable"};throw this.map(error)}}
 async cancel(taskId:string,invocation:AdapterInvocation){const value=await this.gateway(invocation).cancel(taskId);if(value.state==="cancellation_pending")return "cancellation_pending" as const;if(value.state==="cancelled")return "cancelled" as const;if(value.state==="completed"||value.state==="failed")return "already_terminal" as const;throw failure("malformed_response")}
 private map(error:unknown){if(error&&typeof error==="object"&&"category" in error)return error as ClassifiedFailure;if(error instanceof RunnerGatewayError){if(error.code==="authentication_failed")return failure("authentication_failed");if(error.code==="provider_start_ambiguous")return failure("provider_start_ambiguous",undefined,error.transportDiagnostics);if(["runner_busy","runner_unavailable"].includes(error.code))return failure("provider_unavailable",undefined,error.transportDiagnostics);if(["unknown_environment","environment_disabled","environment_not_ready","unknown_model","unsupported_reasoning_effort"].includes(error.code))return failure("configuration_invalid")}return failure("internal_error")}
}
