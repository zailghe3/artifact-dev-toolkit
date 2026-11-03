import {agentExecutionTimeoutSeconds,anthropicMessagesOptionsSchema,openAIAgentsOptionsSchema} from "./workflow-adapter.ts";

export const WORK_IQ_EXECUTION_TIMEOUT_MS=120_000;
export function anthropicMessagesTimeoutMs(maxOutputTokens:number){const bounded=Math.max(1,Math.min(32768,maxOutputTokens));return Math.min(900_000,600_000+bounded*10)}
export const PROVIDER_TRANSPORT_ALLOWANCE_MS=6_000,MAX_PROVIDER_EXECUTION_TIMEOUT_MS=900_000;
export const PROVIDER_GRAPH_NODE_TIMEOUT_MS=MAX_PROVIDER_EXECUTION_TIMEOUT_MS+30_000;
export const PROVIDER_GRAPH_TRANSPORT_TIMEOUT_MS=PROVIDER_GRAPH_NODE_TIMEOUT_MS+10_000;
/** Work IQ has two sequential mutations, each retaining its existing deadline. */
export function providerExecutionTimeoutMs(kind:string,options:unknown){
 switch(kind){
  case "openai-agents":return agentExecutionTimeoutSeconds(openAIAgentsOptionsSchema.parse(options??{}))*1000;
  case "anthropic-messages":return anthropicMessagesTimeoutMs(anthropicMessagesOptionsSchema.parse(options??{}).maxOutputTokens??4096);
  case "work-iq-rest":return WORK_IQ_EXECUTION_TIMEOUT_MS*2;
  default:return undefined;
 }
}
