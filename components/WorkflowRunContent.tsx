"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buttonStyles } from "@/components/Ui";
import { CopyButton } from "@/components/CopyButton";
import { WorkflowResponse, completeResponseText } from "@/components/WorkflowResponse";
import { WorkflowInteraction, interactionLabels } from "@/components/WorkflowInteraction";
import { useWorkflowEvidence } from "@/components/useWorkflowEvidence";
import { conversationRequest } from "@/lib/conversation-client";
import { compareContentPosition, compareEvidenceId } from "@/lib/workflow-evidence-window";
import type { ResponseSection } from "@/lib/conversation-types";
import type { WorkflowInteractionView } from "@/lib/workflow-interactions";
import type { RunContentCursor, RunContentItem, RunContentPage } from "@/lib/workflow-run-content";

const asEvidence = (page: RunContentPage) => ({ ...page, entries: page.items });
const contentPosition = (item: RunContentItem): RunContentCursor => ({
  sequence: item.sequence, id: item.kind === "display" ? item.section.id : item.id,
});

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

export function WorkflowRunContentView({ runId, page, sections, onChanged, onEvidenceAdvanced }: {
  runId: string; page?: RunContentPage; sections: ResponseSection[]; onChanged?: () => void; onEvidenceAdvanced?: () => void;
}) {
  const head = useMemo(() => page && asEvidence(page), [page]);
  const load = useCallback(async (before: RunContentCursor | undefined, signal: AbortSignal) => {
    const query = new URLSearchParams({ view: "content" });
    if (before) { query.set("beforeSequence", String(before.sequence)); query.set("beforeId", before.id); }
    return asEvidence(await conversationRequest<RunContentPage>(`/api/workflow-runs/${runId}/evidence?${query}`, { signal }));
  }, [runId]);
  const { window, loadEarlier, pending, error, refresh } = useWorkflowEvidence(head, load, contentPosition, compareContentPosition);
  useEffect(() => { if (head) refresh(head); }, [head, refresh]);
  const last = window?.head.items.at(-1);
  const lastId = last && contentPosition(last).id;
  useEffect(() => { if (lastId) onEvidenceAdvanced?.(); }, [lastId, onEvidenceAdvanced]);

  const visible = new Map<string, { id: string; sequence: number; section?: ResponseSection;
    entry?: Extract<RunContentItem, { kind: "interaction" }> }>();
  for (const item of window?.entries ?? []) {
    if (item.kind === "display") visible.set(item.section.id, { id: item.section.id, sequence: item.sequence, section: item.section });
    else visible.set(item.id, { id: item.id, sequence: item.sequence, entry: item });
  }
  if (!page && !window) return <WorkflowResponse runId={runId} sections={sections} />;
  const hasTerminalDisplay = [...visible.values()].some(item => item.section?.terminal) ||
    page?.items.some(item => item.kind === "display" && item.section.terminal);
  for (const section of sections) {
    if (!hasTerminalDisplay || section.id !== `${runId}:output`)
      visible.set(section.id, { id: section.id, sequence: section.sequence ?? Number.MAX_SAFE_INTEGER, section });
  }
  if (!visible.size && !error) return null;
  const ordered = [...visible.values()].sort((a, b) => a.sequence - b.sequence || compareEvidenceId(a.id,b.id));
  async function copyOutputs() {
    const committed = await conversationRequest<ResponseSection[]>(`/api/workflow-runs/${runId}/evidence?view=outputs`);
    return completeResponseText(runId, committed);
  }

  return <div className="min-w-0 space-y-3">
    {(ordered.some(item => item.section) || window?.before) && <CopyButton text={copyOutputs} label="all Workflow outputs" compact />}
    {window?.before && <button type="button" className={buttonStyles.subtle} disabled={pending} onClick={loadEarlier}>
      {pending ? "Loading…" : "Load earlier Run content"}
    </button>}
    {error && <p className="text-sm text-destructive" role="alert">{error}
      <button type="button" className={buttonStyles.subtle} onClick={() => refresh()}>Refresh content</button></p>}
    {ordered.map(item => item.entry
      ? <InteractionEntry key={item.id} runId={runId} entry={item.entry} onChanged={onChanged}
          active={window?.head.active?.id === item.id ? window.head.active : undefined} />
      : item.section && <WorkflowResponse key={item.id} runId={runId} sections={[item.section]} copyLabel="section" />)}
  </div>;
}
