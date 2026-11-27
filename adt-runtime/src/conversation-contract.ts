import { z } from "zod";

const validText = (value: string) => !value.includes("\0") && !/[\uD800-\uDFFF]/u.test(value);
const definitionId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
export const ADVISOR_WORKFLOW_ID = "advisor";
export const MAX_CONVERSATION_INPUT_BYTES = 65_536;
export const MAX_EXACT_TURNS = 8;
export const conversationIdSchema = z.uuid().transform(value => value.toLowerCase());
export const conversationTitleSchema = z.string().trim().min(1).max(120).refine(validText);
export const conversationTargetSchema = z.object({ kind: z.enum(["agent", "workflow"]), id: definitionId }).strict();
export const conversationHeadSchema = z.object({ id: conversationIdSchema, generation: z.number().int().positive() }).strict();
export const conversationSubmissionSchema = z.object({
  conversationId: conversationIdSchema,
  turnId: conversationIdSchema,
  after: conversationHeadSchema.nullable(),
  target: conversationTargetSchema,
  message: z.string().min(1).max(MAX_CONVERSATION_INPUT_BYTES).refine(value =>
    Boolean(value.trim()) && validText(value) && new TextEncoder().encode(value).length <= MAX_CONVERSATION_INPUT_BYTES),
  exactTurnIds: z.array(conversationIdSchema).max(MAX_EXACT_TURNS).default([]),
}).strict().refine(value => new Set(value.exactTurnIds).size === value.exactTurnIds.length);
export const conversationCursorSchema = z.object({ updatedAt: z.iso.datetime(), id: conversationIdSchema }).strict();
export const workflowActionIdSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const knowledgeProposalBlockConfigSchema = z.object({ label: z.string().trim().min(1).max(120).optional() }).strict();
export const executionPolicySchema = z.literal("read-only");

export type ConversationTarget = z.infer<typeof conversationTargetSchema>;
export type ConversationHead = z.infer<typeof conversationHeadSchema>;
export type ConversationSubmission = z.infer<typeof conversationSubmissionSchema>;
export type ConversationCursor = z.infer<typeof conversationCursorSchema>;
export type ExecutionPolicy = z.infer<typeof executionPolicySchema>;
export const CONVERSATION_RUN_KEY_PREFIX = "conversation:";
export const conversationRunKey = (submission: ConversationSubmission) =>
  `${CONVERSATION_RUN_KEY_PREFIX}${submission.conversationId}:${submission.turnId}`;
