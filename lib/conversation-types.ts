import type { ConversationCursor, ConversationHead, ConversationTarget } from "../adt-runtime/src/conversation-contract.ts";
import type { RunStatus } from "./workflow-storage.ts";
import type { RunContentPage } from "./workflow-run-content.ts";

export type ConversationSummary = {
  id: string;
  title: string;
  target: ConversationTarget;
  createdAt: string;
  updatedAt: string;
};

export type ConversationList = { items: ConversationSummary[]; next: ConversationCursor | null };

export type ResponseAction = { kind: "knowledge-proposal"; id: string };
export type ResponseSection = {
  id: string;
  label?: string;
  markdown?: string;
  preview?: string;
  contentSource?: "display";
  terminal?: boolean;
  sequence?: number;
  actions?: ResponseAction[];
};

export type ConversationTurn = {
  id: string;
  ordinal: number;
  message: string;
  runId: string;
  status: RunStatus;
  generation: number;
  createdAt: string;
  targetName: string;
  definitionChanged: boolean;
  summaryUsed: boolean;
  summaryLimited?: boolean;
  omittedHistory: number;
  failureMessage?: string;
  externalUrl?: string;
  sections: ResponseSection[];
  content?: RunContentPage;
};

export type ConversationDetail = {
  conversation: ConversationSummary;
  turns: ConversationTurn[];
  earlier: number | null;
  head: ConversationHead;
  retryEligible: boolean;
  approval?: { requestId: string; message: string; reviewText: string };
  awaitingToolReview: boolean;
};

export type ConversationLaunch = { conversationId: string; turnId: string; runId: string; replay: boolean };
export type ConversationTargetOption = ConversationTarget & { name: string; starter?: string };

export const isTerminalTurn = (status: RunStatus) =>
  status === "succeeded" || status === "failed" || status === "cancelled" || status === "rejected";
