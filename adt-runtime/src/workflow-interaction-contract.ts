import { z } from "zod";

export const WORKFLOW_INTERACTION_VERSION = 1;
export const WORKFLOW_INTERACTION_CAPABILITY = "workflow:human-interactions";
export const MAX_INTERACTION_TEXT_BYTES = 262_144;
export const MAX_INTERACTION_FEEDBACK_BYTES = 8_192;
export const MAX_DECISION_OPTION_BYTES = 65_536;
export const MAX_DECISION_OPTIONS = 8;

const encoder = new TextEncoder();
const bytes = (value: string) => encoder.encode(value).length;
const boundedText = (limit: number) => z.string().max(limit).refine(value =>
  !/[\uD800-\uDFFF\0]/u.test(value) && bytes(value) <= limit, `Use up to ${limit} UTF-8 bytes.`);
const prompt = boundedText(2_000).refine(value => Boolean(value.trim()), "Enter a question or instruction.");
const content = boundedText(MAX_INTERACTION_TEXT_BYTES);
const feedback = boundedText(MAX_INTERACTION_FEEDBACK_BYTES);
const optionId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64);
const option = z.object({
  id: optionId,
  title: boundedText(160).refine(value => Boolean(value.trim()), "Enter an option title."),
  description: boundedText(2_000).optional(),
  value: boundedText(16_384).optional(),
}).strict();
export type DecisionOption = z.infer<typeof option>;
export const decisionOptionValue = ({ value, title }: DecisionOption) => value ?? title;
const options = z.array(option).min(2).max(MAX_DECISION_OPTIONS).superRefine((values, ctx) => {
  if (new Set(values.map(value => value.id)).size !== values.length)
    ctx.addIssue({ code: "custom", message: "Each option needs a unique ID." });
  if (bytes(JSON.stringify(values)) > MAX_DECISION_OPTION_BYTES)
    ctx.addIssue({ code: "custom", message: "The combined decision options are too large." });
});

export const dynamicDecisionOptionsSchema = z.object({
  message: prompt.optional(),
  options: options.refine(values => values.every(value => Boolean(value.value?.trim())), "Supply a value for each option."),
}).strict().refine(value => bytes(JSON.stringify(value)) <= MAX_DECISION_OPTION_BYTES, "The decision payload is too large.");

export const humanDecisionConfigSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("static"), message: prompt, routing: z.enum(["data", "branches"]),
    options, allowGuidance: z.boolean().default(false),
  }).strict(),
  z.object({ source: z.literal("dynamic"), message: prompt, allowGuidance: z.boolean().default(false) }).strict(),
]);
export const humanInputConfigSchema = z.object({
  questionSource: z.enum(["configured", "incoming"]),
  question: prompt.optional(), message: prompt.optional(), placeholder: boundedText(240).optional(),
  showContext: z.boolean().default(false), includeContext: z.boolean().default(false), required: z.boolean().default(true),
}).strict().refine(value => value.questionSource === "incoming" ? value.question === undefined : value.question !== undefined,
  { path: ["question"], message: "Supply a question when using a configured question." });
export const humanEditConfigSchema = z.object({ message: prompt }).strict();
export const approvalV2ConfigSchema = z.object({
  message: prompt, allowRevision: z.boolean().default(false), allowReject: z.boolean().default(false),
  requireRevisionFeedback: z.boolean().default(true),
}).strict();
export const displayOutputConfigSchema = z.object({ label: boundedText(160).optional() }).strict();

export function interactionPlanNodes(id: z.ZodString) {
  return [
    z.object({ id, blockType: z.literal("human-decision"), blockVersion: z.literal(1), config: humanDecisionConfigSchema }).strict(),
    z.object({ id, blockType: z.literal("human-input"), blockVersion: z.literal(1), config: humanInputConfigSchema }).strict(),
    z.object({ id, blockType: z.literal("human-edit"), blockVersion: z.literal(1), config: humanEditConfigSchema }).strict(),
    z.object({ id, blockType: z.literal("approval"), blockVersion: z.literal(2), config: approvalV2ConfigSchema }).strict(),
    z.object({ id, blockType: z.literal("display-output"), blockVersion: z.literal(1), config: displayOutputConfigSchema }).strict(),
  ] as const;
}

export function isHumanInteractionBlock(type: string) {
  return type === "approval" || type === "human-decision" || type === "human-input" || type === "human-edit";
}

export function usesInteractiveBlocks(plan: { nodes: readonly { blockType: string; blockVersion: number }[] }) {
  return plan.nodes.some(node => node.blockType === "display-output" ||
    (isHumanInteractionBlock(node.blockType) && (node.blockType !== "approval" || node.blockVersion === 2)));
}

const outcome = z.enum(["approve", "revise", "reject"]);
export type ApprovalOutcome = z.infer<typeof outcome>;

export function approvalOutcomes(config: z.infer<typeof approvalV2ConfigSchema>): ApprovalOutcome[] {
  const choices: ApprovalOutcome[] = ["approve"];
  if (config.allowRevision) choices.push("revise");
  if (config.allowReject) choices.push("reject");
  return choices;
}

export const approvalOutcomeLabels: Record<ApprovalOutcome, string> = {
  approve: "Approve", revise: "Request revision", reject: "Reject",
};

const requestBase = { version: z.literal(WORKFLOW_INTERACTION_VERSION), question: prompt };
export const interactionRequestSchema = z.discriminatedUnion("kind", [
  z.object({ ...requestBase, kind: z.literal("decision"), options, allowGuidance: z.boolean(),
    routing: z.enum(["data", "branches"]) }).strict(),
  z.object({ ...requestBase, kind: z.literal("input"), message: prompt.optional(), placeholder: boundedText(240).optional(),
    sourceContext: content, showContext: z.boolean(), includeContext: z.boolean(), required: z.boolean() }).strict(),
  z.object({ ...requestBase, kind: z.literal("edit"), original: content }).strict(),
  z.object({ ...requestBase, kind: z.literal("approval"), reviewed: content,
    outcomes: z.array(outcome).min(1).max(3), requireRevisionFeedback: z.boolean(), rejectTerminates: z.boolean() }).strict(),
]);
export type InteractionRequest = z.infer<typeof interactionRequestSchema>;

export const interactionResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("decision"), optionId, guidance: feedback.optional() }).strict(),
  z.object({ kind: z.literal("input"), text: content }).strict(),
  z.object({ kind: z.literal("edit"), text: content }).strict(),
  z.object({ kind: z.literal("approval"), outcome, feedback: feedback.optional() }).strict(),
]);
export type InteractionResponse = z.infer<typeof interactionResponseSchema>;
export const interactionIdSchema = z.uuid();

export const graphInteractionSchema = z.object({
  kind: z.literal("workflow-interaction"), nodeId: z.string().min(1).max(256), activationId: z.string().min(1).max(256),
  sequence: z.number().int().positive(), request: interactionRequestSchema,
}).strict();
export type GraphInteraction = z.infer<typeof graphInteractionSchema>;

/** Checks the exact issued request and builds the text handed to the next block. */
export function resolveInteraction(request: InteractionRequest, response: InteractionResponse) {
  if (request.kind === "decision" && response.kind === "decision") {
    const selected = request.options.find(option => option.id === response.optionId);
    if (!selected || (!request.allowGuidance && response.guidance !== undefined)) throw new Error("interaction_response_invalid");
    return {
      output: JSON.stringify({ selectedTitle: selected.title, selectedValue: decisionOptionValue(selected),
        ...(response.guidance === undefined ? {} : { humanGuidance: response.guidance }) }),
      route: request.routing === "branches" ? selected.id : undefined,
    };
  }
  if (request.kind === "input" && response.kind === "input") {
    if (request.required && !response.text.trim()) throw new Error("interaction_response_invalid");
    return { output: request.includeContext ? JSON.stringify({ humanResponse: response.text, incomingContext: request.sourceContext })
      : response.text, route: undefined };
  }
  if (request.kind === "edit" && response.kind === "edit") return { output: response.text, route: undefined };
  if (request.kind === "approval" && response.kind === "approval") {
    if (!request.outcomes.includes(response.outcome) ||
        (response.outcome === "revise" && request.requireRevisionFeedback && !response.feedback?.trim()))
      throw new Error("interaction_response_invalid");
    const output = response.outcome === "revise" || response.feedback?.length
      ? JSON.stringify({ reviewedContent: request.reviewed, humanFeedback: response.feedback ?? "" })
      : request.reviewed;
    return { output, route: response.outcome };
  }
  throw new Error("interaction_response_invalid");
}

export function validateInteractionResponse(request: InteractionRequest, response: InteractionResponse) {
  const result = resolveInteraction(request, response);
  if (bytes(result.output) > MAX_INTERACTION_TEXT_BYTES &&
      !(request.kind === "approval" && request.rejectTerminates && response.kind === "approval" && response.outcome === "reject"))
    throw new Error("interaction_output_too_large");
  return result;
}
