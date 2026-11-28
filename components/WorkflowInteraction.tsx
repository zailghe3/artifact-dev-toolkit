"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import {
  approvalOutcomeLabels, decisionOptionValue, interactionResponseSchema, MAX_INTERACTION_FEEDBACK_BYTES, MAX_INTERACTION_TEXT_BYTES,
  type ApprovalOutcome, type DecisionOption, type InteractionResponse,
} from "../adt-runtime/src/workflow-interaction-contract";
import { buttonStyles } from "@/components/Ui";
import { WorkflowResponse } from "@/components/WorkflowResponse";
import { conversationRequest, ConversationRequestError, jsonTurnRequest } from "@/lib/conversation-client";
import type { WorkflowInteractionView } from "@/lib/workflow-interactions";

export const interactionLabels: Record<string, string> = {
  decision: "Human Decision", input: "Human Input", edit: "Human Edit", approval: "Workflow Approval",
};
const itemUrl = (runId: string, id: string) => `/api/workflow-runs/${runId}/interactions/${id}`;

function ReviewText({ runId, label, text }: { runId: string; label: string; text: string }) {
  return <WorkflowResponse runId={runId} sections={[{ id: label, label, markdown: text }]} />;
}

function OptionDescription({ option }: { option: DecisionOption }) {
  return option.description && option.description !== option.title
    ? <span className="block whitespace-pre-wrap wrap-anywhere text-muted-foreground">{option.description}</span> : null;
}

function OptionContent({ runId, option, selected = false, className = "" }: {
  runId: string; option: DecisionOption; selected?: boolean; className?: string;
}) {
  const value = decisionOptionValue(option);
  if (value === option.title || (!selected && value === option.description)) return null;
  const label = selected ? "Selected content" : "Option content";
  return <details className={`min-w-0 space-y-2 ${className}`}>
    <summary className="cursor-pointer text-sm font-medium" aria-label={`${label} for ${option.title}`}>{label}</summary>
    {value === "" ? <p className="text-sm text-muted-foreground">Empty value</p> :
      <WorkflowResponse runId={runId} sections={[{ id: option.id, markdown: value }]} copyLabel={label.toLowerCase()} />}
  </details>;
}

function RecordedDecision({ runId, options, response }: {
  runId: string; options: DecisionOption[]; response: Extract<InteractionResponse, { kind: "decision" }>;
}) {
  const selected = options.find(option => option.id === response.optionId);
  return <>
    <p className="text-sm">Selected <strong className="whitespace-pre-wrap wrap-anywhere">{selected?.title ?? response.optionId}</strong></p>
    {selected && <OptionContent runId={runId} option={selected} selected />}
    {response.guidance && <ReviewText runId={runId} label="Human guidance" text={response.guidance} />}
    <details>
      <summary className="cursor-pointer text-sm">View offered options</summary>
      <ul className="mt-2 space-y-2 text-sm">{options.map(option => <li key={option.id} className="min-w-0">
        <strong className="whitespace-pre-wrap wrap-anywhere">{option.title}</strong>
        {option.id === response.optionId && <span className="ml-2 text-muted-foreground">Selected</span>}
        {option.id !== response.optionId || option.description !== decisionOptionValue(option) ? <OptionDescription option={option} /> : null}
        {option.id !== response.optionId && <OptionContent runId={runId} option={option} />}
      </li>)}</ul>
    </details>
  </>;
}

export function WorkflowInteraction({
  runId, item, onAccepted, onChanged,
}: {
  runId: string; item: WorkflowInteractionView;
  onAccepted: (item: WorkflowInteractionView) => void; onChanged?: () => void;
}) {
  const { id, request, response } = item;
  const fieldId = useId();
  const inFlight = useRef(false);
  const [draft, setDraft] = useState(request.kind === "edit" ? request.original : "");
  const [selected, setSelected] = useState("");
  const [feedback, setFeedback] = useState("");
  const [preview, setPreview] = useState(false);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState<InteractionResponse>();
  const [error, setError] = useState("");
  const url = itemUrl(runId, id);
  const revisionRequired = request.kind === "approval" && selected === "revise" && request.requireRevisionFeedback;
  const valid = ((request.kind !== "decision" && request.kind !== "approval") || Boolean(selected)) &&
    (!revisionRequired || Boolean(feedback.trim())) && (request.kind !== "input" || !request.required || Boolean(draft.trim()));
  const question = <p className="whitespace-pre-wrap wrap-anywhere font-medium">{request.question}</p>;
  const reviewed = request.kind === "approval" ? request.reviewed
    : request.kind === "edit" ? request.original
      : request.kind === "input" ? request.sourceContext : undefined;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !item.actionable || (!uncertain && !valid)) return;
    const candidate = uncertain ?? (request.kind === "decision" ? { kind: "decision", optionId: selected,
      ...(feedback ? { guidance: feedback } : {}) }
      : request.kind === "approval" ? { kind: "approval", outcome: selected as ApprovalOutcome, ...(feedback ? { feedback } : {}) }
        : { kind: request.kind, text: draft });
    const parsed = interactionResponseSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your response.");
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      const accepted = await conversationRequest<WorkflowInteractionView>(url, jsonTurnRequest(parsed.data));
      setUncertain(undefined);
      onAccepted(accepted);
      onChanged?.();
    } catch (failure) {
      const status = failure instanceof ConversationRequestError ? failure.status : 0;
      if ([400, 401, 403, 413, 422].includes(status)) {
        setUncertain(undefined);
        setError(failure instanceof Error ? failure.message : "Check your response and try again.");
      } else {
        try {
          const saved = await conversationRequest<WorkflowInteractionView>(url);
          setUncertain(undefined);
          onAccepted(saved);
          onChanged?.();
          if (saved.actionable) setError("This request is still waiting. You can submit again.");
        } catch {
          setUncertain(parsed.data);
          setError("ADT could not verify receipt. You can retry this same response.");
        }
      }
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return <section aria-label={interactionLabels[request.kind]} className="space-y-3 rounded-lg border border-border bg-card p-4">
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-sm font-semibold">{interactionLabels[request.kind]}</h4>
      <span className="text-xs text-muted-foreground">{item.nodeId}</span>
    </header>
    {question}
    {request.kind === "input" && request.message && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{request.message}</p>}
    {reviewed !== undefined && <details open={request.kind === "approval" && item.actionable ? true : undefined}>
      <summary className="cursor-pointer text-sm font-medium">{request.kind === "input" ? "View context" : "View original content"}</summary>
      <ReviewText runId={runId} label={request.kind === "input" ? "Workflow context" : "Original content"} text={reviewed} />
    </details>}
    {response ? <div className="space-y-2" role="status">
      <p className="text-sm font-medium">Response recorded
        {item.responder ? ` · @${item.responder}` : ""}</p>
      {response.kind === "decision" && request.kind === "decision" &&
        <RecordedDecision runId={runId} options={request.options} response={response} />}
      {response.kind === "approval" && <>
        <p className="text-sm font-medium">{response.outcome === "revise" ? "Revision requested"
          : response.outcome === "reject" ? "Rejected" : "Approved"}</p>
        {response.feedback && <ReviewText runId={runId} label="Human feedback" text={response.feedback} />}
      </>}
      {(response.kind === "input" || response.kind === "edit") && (
        response.kind === "input" && !response.text ? <p className="text-sm text-muted-foreground">Continued without an answer.</p>
          : <ReviewText runId={runId} label={response.kind === "edit" ? "Confirmed text" : "Human answer"} text={response.text} />
      )}
    </div> : item.actionable ? <form onSubmit={submit} className="space-y-3" aria-busy={pending}>
      <fieldset disabled={pending || Boolean(uncertain)} className="min-w-0 space-y-3">
        {(request.kind === "decision" || request.kind === "approval") && <>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">{request.kind === "decision" ? "Choose an option" : "Choose an outcome"}</legend>
            {(request.kind === "decision" ? request.options : request.outcomes.map(outcome => ({ id: outcome, title: approvalOutcomeLabels[outcome] }))).map(option =>
              <div key={option.id} className="min-w-0 rounded-md border border-border has-checked:border-ring">
                <label className="flex cursor-pointer items-start gap-3 p-3">
                  <input className="mt-1 accent-primary" type="radio" name={fieldId} value={option.id}
                    checked={selected === option.id} onChange={() => setSelected(option.id)} />
                  <span className="min-w-0 text-sm"><strong className="whitespace-pre-wrap wrap-anywhere">{option.title}</strong>
                    {request.kind === "decision" && <OptionDescription option={option} />}
                  </span>
                </label>
                {request.kind === "decision" && <OptionContent runId={runId} option={option} className="mx-3 mb-3" />}
              </div>
            )}
          </fieldset>
          {(request.kind === "approval" || request.allowGuidance) && <label className="block text-sm font-medium">
            {request.kind === "decision" ? "Additional guidance (optional)" : revisionRequired ? "Revision feedback (required)" : "Feedback (optional)"}
            <textarea className="adt-field mt-1" rows={3} value={feedback} maxLength={MAX_INTERACTION_FEEDBACK_BYTES}
              required={revisionRequired} onChange={event => setFeedback(event.target.value)} />
          </label>}
        </>}
        {(request.kind === "input" || request.kind === "edit") && <label className="block text-sm font-medium">
          {request.kind === "edit" ? "Editable text" : request.required ? "Your answer (required)" : "Your answer (optional)"}
          <textarea className="adt-field mt-1 font-mono" rows={request.kind === "edit" ? 8 : 4}
            value={draft} maxLength={MAX_INTERACTION_TEXT_BYTES} required={request.kind === "input" && request.required}
            placeholder={request.kind === "input" ? request.placeholder : undefined} onChange={event => setDraft(event.target.value)} />
        </label>}
        {request.kind === "edit" && <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonStyles.subtle} aria-pressed={preview} onClick={() => setPreview(value => !value)}>
            {preview ? "Hide preview" : "Preview Markdown"}
          </button>
          <button type="button" className={buttonStyles.subtle} onClick={() => setDraft(request.original)}
            disabled={draft === request.original}>Reset to original</button>
        </div>}
      </fieldset>
      {request.kind === "edit" && preview && <ReviewText runId={runId} label="Draft preview" text={draft} />}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <button className={buttonStyles.primary} type="submit" disabled={pending || (!valid && !uncertain)}>
        {pending ? "Submitting…" : uncertain ? "Retry response" : request.kind === "edit" ? "Confirm text"
          : request.kind === "decision" ? "Confirm selection" : request.kind === "approval" ? "Confirm outcome"
            : draft || request.required ? "Submit answer" : "Continue without an answer"}
      </button>
    </form> : <p className="text-sm text-muted-foreground">This request closed without a response.</p>}
  </section>;
}
