import type {AdapterInvocation,AgentProviderAdapter} from "./workflow-adapter.ts";
import {codexCloudOptionsSchema} from "./workflow-adapter.ts";
import type {CodexCloudGateway} from "./codex-cloud-gateway.ts";

export const composeCodexPrompt=(masterPrompt:string,inputText:string)=>`${masterPrompt}\n\nTask:\n\n${inputText}`;
type Snapshot={externalEnvironmentId?:string};
export class CodexCloudAdapter implements AgentProviderAdapter{
 readonly kind="codex-cloud";
 private gateway:CodexCloudGateway;
 constructor(gateway:CodexCloudGateway){this.gateway=gateway;}
 async validateConnection(descriptor:AdapterInvocation["connection"]){return descriptor.enabled?{ok:true as const}:{ok:false as const,safeMessage:"Codex Cloud transport is unavailable."};}
 async start(invocation:AdapterInvocation){codexCloudOptionsSchema.parse(invocation.providerOptions);const environmentId=(invocation.connection.serverConfiguration as Snapshot|undefined)?.externalEnvironmentId;if(!environmentId)throw Object.assign(new Error("Codex environment snapshot unavailable."),{category:"configuration_invalid"});const task=await this.gateway.start({environmentId,prompt:composeCodexPrompt(invocation.masterPrompt,invocation.inputText),idempotencyKey:invocation.idempotencyKey});return{state:"pending" as const,taskId:task.taskId,pollAfterMs:1000,providerState:"task_running",taskUrl:task.taskUrl};}
 async check(taskId:string,invocation:AdapterInvocation){const saved=invocation.connection.privateOptions as {providerState?:string;outputText?:string}|undefined;if(saved?.providerState==="task_completed"||saved?.providerState==="publishing_pr"){if(!this.gateway.publishPullRequest)return{state:"failed" as const,category:"malformed_response" as const,retryable:false,safeMessage:"Codex completed without a supported pull-request publication result."};const published=await this.gateway.publishPullRequest(taskId,`${invocation.idempotencyKey}:publish`);return published.state==="pending"?{state:"pending" as const,pollAfterMs:published.pollAfterMs,providerState:"publishing_pr",outputText:saved.outputText}:{state:"completed" as const,outputText:saved.outputText??"",externalUrl:published.pullRequestUrl};}
  const status=await this.gateway.check(taskId);if(status.state!=="completed")return status;if(status.pullRequest)return{state:"completed" as const,outputText:status.outputText,externalUrl:status.pullRequest.url,taskUrl:status.taskUrl};return{state:"pending" as const,pollAfterMs:0,providerState:"task_completed",outputText:status.outputText,taskUrl:status.taskUrl};}
 async cancel(taskId:string){return this.gateway.cancel?this.gateway.cancel(taskId):"unsupported" as const;}
}
