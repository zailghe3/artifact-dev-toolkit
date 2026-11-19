/** The existing model-family rules only establish eligibility for ADT tool calling. */
export function agentToolModelEligibility(provider:string,model:string,hasTools:boolean):"tool_free"|"eligible"|"ineligible"|"verify_at_runtime"{
  if(!hasTools)return "tool_free";
  switch(provider){
    case "openai-agents":
      return !/codex|pro/.test(model)&&/^(gpt-(4o|4\.1|5)(?:[.-]|$)|o[134](?:-|$))/.test(model)?"eligible":"ineligible";
    case "anthropic-messages":
      return /^claude-(?:3[.-]|sonnet-|opus-|haiku-)/.test(model)?"eligible":"ineligible";
    case "ollama-chat":
      return "verify_at_runtime";
    default:
      return "ineligible";
  }
}
