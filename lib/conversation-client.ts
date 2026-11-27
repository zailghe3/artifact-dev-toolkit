import type { ConversationTarget } from "../adt-runtime/src/conversation-contract.ts";

export type ConversationView = "/conversations" | "/advisor";

export function conversationHref(view: ConversationView, id?: string, target?: ConversationTarget) {
  const query = new URLSearchParams();
  if (id) query.set("conversation", id);
  if (target) query.set(target.kind, target.id);
  return query.size ? `${view}?${query}` : view;
}

export class ConversationRequestError extends Error {
  constructor(readonly status: number, readonly code: string | undefined, message: string) {
    super(message);
  }
}

export async function conversationRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json() as T & { error?: string; code?: string };
  if (!response.ok) throw new ConversationRequestError(response.status, body.code, body.error ?? "The request could not be completed.");
  return body;
}

export const jsonTurnRequest = (body: unknown, method = "POST") =>
  ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
