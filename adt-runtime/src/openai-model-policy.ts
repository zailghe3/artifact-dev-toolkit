export const openAIReasoningEfforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const openAIVerbosities = ["low", "medium", "high"] as const;
export const openAIMaxOutputTokens = 262_144;

type OpenAIAPI = "chat-completions" | "responses";
type ModelIssue = {
  category: "provider_api_unsupported" | "tool_proposals_unsupported" | "unsupported_model_option" | "model_unavailable";
  safeMessage: string;
};
const responsesOnly: ModelIssue = {
  category: "provider_api_unsupported",
  safeMessage: "This model requires the OpenAI Responses API. Select a Chat Completions model for journaled Agents, or use an OpenAI Responses connection for tool-free work.",
};

/** Only explicit, documented restrictions for exact IDs. Other support is unknown. */
export function openAIModelCompatibilityIssue(
  api: OpenAIAPI,
  model: string,
  options: {reasoningEffort?: string; maxOutputTokens?: number},
  hasTools = false,
): ModelIssue | undefined {
  // https://developers.openai.com/api/docs/models/gpt-5-pro
  if (model === "gpt-5-pro" || model === "gpt-5-pro-2025-10-06") {
    if (api === "chat-completions") return responsesOnly;
    if (options.reasoningEffort !== undefined && options.reasoningEffort !== "high")
      return {category: "unsupported_model_option", safeMessage: "GPT-5 pro supports only High reasoning effort. Choose High or Provider default."};
  }
  // https://developers.openai.com/api/docs/models/gpt-6-luna
  if (model === "gpt-6-luna") {
    if (api === "chat-completions" && hasTools && options.reasoningEffort !== "none")
      return {category: "unsupported_model_option", safeMessage: "GPT-6 Luna requires reasoning effort None to propose tools through Chat Completions. Set the Agent’s reasoning effort to None or choose another model."};
    if (options.maxOutputTokens !== undefined && options.maxOutputTokens > 128_000)
      return {category: "unsupported_model_option", safeMessage: "GPT-6 Luna supports a maximum of 128,000 output tokens. Lower the Agent’s maximum output tokens."};
  }
}

const optionFields = new Map<string, string>([
  ["reasoning_effort", "reasoning effort"], ["reasoning.effort", "reasoning effort"],
  ["verbosity", "verbosity"], ["text.verbosity", "verbosity"],
  ["max_completion_tokens", "maximum output tokens"], ["max_output_tokens", "maximum output tokens"],
]);

/** Interpret structured OpenAI errors, keeping only bounded, ADT-authored diagnostics. */
export function openAIRequestRejection(status: number, body: unknown, api: OpenAIAPI): ModelIssue | undefined {
  if (![400, 403, 404, 422].includes(status) || !body || typeof body !== "object") return;
  const {code, param, message} = body as Record<string, unknown>;
  if (code === "model_not_found" || code === "model_not_available")
    return {category: "model_unavailable", safeMessage: "The selected model is unavailable to this OpenAI project. Load the available models for this connection or check project access."};
  if (status === 403) return;
  const text = typeof message === "string" ? message.slice(0, 2048) : "";
  if (api === "chat-completions" && /(?:not a chat model.*v1\/chat\/completions|model is not supported (?:on|in|by|with) (?:the )?(?:Chat Completions API|v1\/chat\/completions)|model (?:is )?only (?:available|supported) (?:in|on|via|through) (?:the )?(?:v1\/responses|(?:OpenAI )?Responses API))/i.test(text))
    return responsesOnly;
  if (code === "unsupported_parameter" || code === "unsupported_value" || code === "invalid_value" || code === "invalid_request_error") {
    const option = typeof param === "string" ? optionFields.get(param) : undefined;
    if (option) return {category: "unsupported_model_option", safeMessage: `OpenAI rejected the requested ${option} for this model and API. Adjust the Agent setting or choose another model.`};
  }
  if ((param === "tools" && code === "unsupported_parameter") ||
      /(?:model (?:does not|doesn't) support (?:tools|function calling|tool calling)|(?:function calling|tool calling) is not supported (?:for|by|with) (?:this|the) model)/i.test(text))
    return {category: "tool_proposals_unsupported", safeMessage: "OpenAI reported that the selected model cannot propose tools with this request. Check the Agent’s reasoning effort and model, or remove tool grants for this block."};
}
