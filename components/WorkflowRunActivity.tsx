"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buttonStyles } from "@/components/Ui";
import { LocalizedTime } from "@/components/LocalizedTime";
import { useWorkflowEvidence } from "@/components/useWorkflowEvidence";
import { conversationRequest } from "@/lib/conversation-client";
import { isTerminalTurn } from "@/lib/conversation-types";
import { compareActivityPosition } from "@/lib/workflow-evidence-window";
import type { ActivityCursor, RunActivity, RunActivityPage } from "@/lib/workflow-run-activity";
import type { RunStatus } from "@/lib/workflow-storage";

const waits: Record<string, string> = {
  decision: "Waiting for a decision", input: "Waiting for an answer", edit: "Waiting for confirmed text",
  approval: "Waiting for Workflow approval", tool: "Waiting for sensitive tool approval",
};
const stateLabels: Record<string, string> = {
  queued: "Queued", running: "Running", completed: "Completed", failed: "Failed", cancelled: "Cancelled",
  abandoned: "Stopped before completion", superseded: "Superseded", resuming: "Response recorded",
  approved: "Tool call approved", rejected: "Tool call rejected", expired: "Tool approval expired",
};

function duration(from?: string, to?: string) {
  if (!from || !to) return;
  const ms = Math.max(0, Date.parse(to) - Date.parse(from));
  if (ms < 1_000) return "<1 s";
  const seconds = Math.floor(ms / 1_000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function ActivityRow({ entry }: { entry: RunActivity }) {
  const label = entry.state === "waiting" ? waits[entry.interactionKind ?? ""] ?? "Waiting for a human response"
    : stateLabels[entry.state] ?? entry.state;
  const elapsed = duration(entry.startedAt, entry.interactionKind ? entry.respondedAt ?? entry.completedAt : entry.completedAt);
  const route = entry.route && (entry.blockType === "approval" ? { approve: "Approve", revise: "Request revision", reject: "Reject" }[entry.route]
    : entry.route);
  const meta = [entry.iteration && entry.iteration > 1 ? `Visit ${entry.iteration}` : undefined,
    entry.attempt && entry.attempt > 1 ? `Attempt ${entry.attempt}` : undefined,
    entry.parallel ? "Parallel branch" : undefined,
    route ? `Route ${route}` : undefined,
    elapsed ? `${entry.interactionKind ? "Waited " : ""}${elapsed}` : undefined].filter(Boolean);
  return <li className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 border-b border-border py-2 last:border-0">
    <div className="min-w-0">
      <p className="break-words text-sm font-medium">{entry.name}</p>
      <p className="text-xs text-muted-foreground">{[label, ...meta].join(" · ")}</p>
    </div>
    <span className="text-xs text-muted-foreground"><LocalizedTime value={entry.at} /></span>
  </li>;
}

const activityUrl = (runId: string, before?: ActivityCursor) => {
  const query = new URLSearchParams({ view: "activity" });
  if (before) { query.set("beforeAt", before.at); query.set("beforeId", before.id); }
  return `/api/workflow-runs/${runId}/evidence?${query}`;
};
const activityPosition = (entry: RunActivity): ActivityCursor => ({ at: entry.at, id: entry.id });

export function WorkflowRunActivity({ runId, status }: { runId: string; status: RunStatus }) {
  const active = !isTerminalTurn(status);
  const [expanded, setExpanded] = useState<boolean>();
  const open = expanded ?? active;
  const viewed = useRef(false);
  const load = useCallback((before: ActivityCursor | undefined, signal: AbortSignal) =>
    conversationRequest<RunActivityPage>(activityUrl(runId, before), { signal }), [runId]);
  const { window, pending, error, loadEarlier, refresh } = useWorkflowEvidence(undefined, load, activityPosition, compareActivityPosition);
  const entries = [...(window?.entries ?? [])].sort((a,b) => compareActivityPosition(b,a));

  useEffect(() => {
    if (!open) {
      if (!active && viewed.current) refresh();
      return;
    }
    viewed.current = true;
    refresh();
    if (active) {
      const timer = setInterval(() => { if (document.visibilityState !== "hidden") refresh(); }, 2_000);
      return () => clearInterval(timer);
    }
  }, [active, open, refresh]);

  return <details open={open} onToggle={event => {
      if (event.currentTarget.open !== open) setExpanded(event.currentTarget.open);
    }} className="rounded-lg border border-border px-3 py-2">
    <summary className="cursor-pointer text-sm font-medium">
      Workflow activity{window?.head.completed ? ` · ${window.head.completed} completed` : ""}
    </summary>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}
      <button type="button" className={buttonStyles.subtle} onClick={() => refresh()}>Refresh</button></p>}
    {!entries.length && !error && <p className="py-2 text-xs text-muted-foreground">
      {window ? "No block activity has been recorded." : "Loading activity…"}
    </p>}
    <ol className="mt-1">{entries.map(entry => <ActivityRow key={entry.id} entry={entry} />)}</ol>
    {window?.before && <button type="button" className={buttonStyles.subtle} disabled={pending} onClick={loadEarlier}>
      {pending ? "Loading…" : "Load earlier activity"}
    </button>}
  </details>;
}
