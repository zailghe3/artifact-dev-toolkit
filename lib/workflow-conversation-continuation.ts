import type {GenericWorkflowExecutionPlan} from "./workflow-definitions.ts";
import type {RunDetail,StepAttempt,WorkflowRunStorage} from "./workflow-storage.ts";

export const CONVERSATION_UNAVAILABLE_MESSAGE="The selected Codex conversation is no longer available to continue.";

export class ConversationUnavailableError extends Error {
  readonly category="conversation_unavailable";
  readonly safeMessage=CONVERSATION_UNAVAILABLE_MESSAGE;
  readonly retryable=false;
  constructor(){super("conversation_unavailable")}
}

const sameAttempt=(attempt:StepAttempt,source:NonNullable<StepAttempt["conversationSource"]>)=>attempt.runId===source.runId&&attempt.stepId===source.stepId&&attempt.graphActivationId===source.activationId&&attempt.iteration===source.iteration&&attempt.attempt===source.attempt;

export function resolveBoundConversationSource(detail:RunDetail,target:StepAttempt){
  const source=target.conversationSource&&detail.attempts.find(attempt=>sameAttempt(attempt,target.conversationSource!));
  if(!source||source.status!=="succeeded"||!source.providerTaskId)throw new ConversationUnavailableError();
  return source;
}

export async function ensureConversationSourceBinding(input:{detail:RunDetail;target:StepAttempt;node:GenericWorkflowExecutionPlan["nodes"][number];storage:WorkflowRunStorage}){
  const conversation=input.node.blockType==="agent"&&input.node.blockVersion===3?input.node.config.conversation:undefined;
  if(!conversation)return undefined;
  if(input.target.conversationSource)return resolveBoundConversationSource(input.detail,input.target);
  const source=input.detail.attempts.filter(attempt=>attempt.stepId===conversation.sourceNodeId&&attempt.status==="succeeded").at(-1);
  if(!source?.providerTaskId)throw new ConversationUnavailableError();
  const bound=await input.storage.bindConversationSource(input.target.runId,input.target.stepId,input.target.iteration,input.target.attempt,{runId:source.runId,stepId:source.stepId,activationId:source.graphActivationId,iteration:source.iteration,attempt:source.attempt});
  return resolveBoundConversationSource(input.detail,bound);
}
