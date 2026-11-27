"use client";

import { useState } from "react";
import { buttonStyles } from "@/components/Ui";
import { CopyButton } from "@/components/CopyButton";
import { WorkflowResponse, completeResponseText } from "@/components/WorkflowResponse";
import { WorkflowInteraction, interactionLabels } from "@/components/WorkflowInteraction";
import { conversationRequest } from "@/lib/conversation-client";
import type { ResponseSection } from "@/lib/conversation-types";
import type { WorkflowInteractionView } from "@/lib/workflow-interactions";
import type { RunContentCursor, RunContentItem, RunContentPage } from "@/lib/workflow-run-content";

function contentBefore(runId: string, before: RunContentCursor) {
  const query = new URLSearchParams({ view: "content", beforeSequence: String(before.sequence), beforeId: before.id });
  return conversationRequest<RunContentPage>(`/api/workflow-runs/${runId}/evidence?${query}`);
}

function InteractionEntry({ runId, entry, active, onChanged }: {
  runId: string; entry: Extract<RunContentItem, { kind: "interaction" }>;
  active?: WorkflowInteractionView; onChanged?: () => void;
}) {
  const [review, setReview] = useState<WorkflowInteractionView>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const item = active?.response ? active : review ?? active;

  async function load() {
    setError("");
    setPending(true);
    try {
      setReview(await conversationRequest<WorkflowInteractionView>(`/api/workflow-runs/${runId}/interactions/${entry.id}`));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The interaction could not be loaded.");
    } finally {
      setPending(false);
    }
  }

  if (item) return <WorkflowInteraction runId={runId} item={{ ...item, actionable: Boolean(active?.actionable && item.actionable) }}
    onAccepted={setReview} onChanged={onChanged} />;
  return <section className="space-y-2 rounded-lg border border-border p-4">
    <h4 className="text-sm font-semibold">{interactionLabels[entry.interactionKind] ?? "Workflow interaction"}</h4>
    <p className="whitespace-pre-wrap wrap-anywhere">{entry.question}</p>
    {entry.responded && <p className="whitespace-pre-wrap wrap-anywhere text-sm text-muted-foreground">
      {entry.responsePreview || "Continued without an answer."}
    </p>}
    <button type="button" className={buttonStyles.subtle} disabled={pending} onClick={() => void load()}>
      {pending ? "Loading…" : "View interaction"}
    </button>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
  </section>;
}

export function WorkflowRunContentView({ runId, page, sections, onChanged }: {
  runId: string; page?: RunContentPage; sections: ResponseSection[]; onChanged?: () => void;
}) {
  const [older, setOlder] = useState<RunContentPage>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const cursor = older ? older.before : page?.before;
  const visible = new Map<string, { id: string; sequence: number; section?: ResponseSection;
    entry?: Extract<RunContentItem, { kind: "interaction" }> }>();
  for (const item of [...(older?.items ?? []), ...(page?.items ?? [])]) {
    if (item.kind === "display") visible.set(item.section.id, { id: item.section.id, sequence: item.sequence, section: item.section });
    else visible.set(item.id, { id: item.id, sequence: item.sequence, entry: item });
  }
  if (!visible.size) return <WorkflowResponse runId={runId} sections={sections} />;
  const hasTerminalDisplay = [...visible.values()].some(item => item.section?.terminal);
  for (const section of sections) {
    if (!hasTerminalDisplay || section.id !== `${runId}:output`)
      visible.set(section.id, { id: section.id, sequence: section.sequence ?? Number.MAX_SAFE_INTEGER, section });
  }
  const ordered = [...visible.values()].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));

  async function loadEarlier() {
    if (!cursor) return;
    setPending(true);
    setError("");
    try {
      const next = await contentBefore(runId, cursor);
      setOlder(previous => ({ ...next, items: [...next.items, ...(previous?.items ?? []), ...(page?.items ?? [])] }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Earlier Run content could not be loaded.");
    } finally {
      setPending(false);
    }
  }

  const outputs = ordered.flatMap(item => item.section ? [{ section: item.section, sequence: item.sequence }] : []);
  async function copyOutputs() {
    const sections = new Map(outputs.map(item => [item.section.id, item]));
    let next = cursor;
    while (next) {
      const page = await contentBefore(runId, next);
      for (const item of page.items) if (item.kind === "display") sections.set(item.section.id, item);
      next = page.before;
    }
    const ordered = [...sections.values()].sort((a, b) => a.sequence - b.sequence || a.section.id.localeCompare(b.section.id));
    return completeResponseText(runId, ordered.map(item => item.section));
  }

  return <div className="min-w-0 space-y-3">
    {(outputs.length > 1 || cursor) && <CopyButton text={copyOutputs} label="all Workflow outputs" compact />}
    {cursor && <button type="button" className={buttonStyles.subtle} disabled={pending} onClick={() => void loadEarlier()}>
      {pending ? "Loading…" : "Load earlier Run content"}
    </button>}
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    {ordered.map(item => item.entry
      ? <InteractionEntry key={item.id} runId={runId} entry={item.entry} onChanged={onChanged}
          active={page?.active?.id === item.id ? page.active : undefined} />
      : item.section && <WorkflowResponse key={item.id} runId={runId} sections={[item.section]} />)}
  </div>;
}
