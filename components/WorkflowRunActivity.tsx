"use client";

import { useEffect, useState } from "react";
import { buttonStyles } from "@/components/Ui";
import { LocalizedTime } from "@/components/LocalizedTime";
import { conversationRequest } from "@/lib/conversation-client";
import { isTerminalTurn } from "@/lib/conversation-types";
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

export function WorkflowRunActivity({ runId, status }: { runId: string; status: RunStatus }) {
  const active = !isTerminalTurn(status);
  const [expanded, setExpanded] = useState<boolean>();
  const open = expanded ?? active;
  const [page, setPage] = useState<RunActivityPage>();
  const [older, setOlder] = useState<RunActivityPage>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const before = older ? older.before : page?.before;
  const entries = [...new Map([...(older?.entries ?? []), ...(page?.entries ?? [])].map(entry => [entry.id, entry])).values()]
    .sort((a,b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));

  useEffect(() => {
    if (!open) return;
    let controller: AbortController | undefined;
    const load = () => {
      if (document.visibilityState === "hidden") return;
      controller?.abort();
      const current = controller = new AbortController();
      void conversationRequest<RunActivityPage>(activityUrl(runId), { signal: current.signal }).then(result => {
        if (!current.signal.aborted) { setPage(result); setError(""); }
      }, failure => {
        if (!current.signal.aborted) setError(failure instanceof Error ? failure.message : "Activity is unavailable.");
      });
    };
    load();
    const timer = active ? setInterval(load, 2_000) : undefined;
    return () => { clearInterval(timer); controller?.abort(); };
  }, [runId, active, open, refresh]);

  async function loadEarlier() {
    if (!before) return;
    setPending(true);
    try {
      const earlier = await conversationRequest<RunActivityPage>(activityUrl(runId, before));
      setOlder(previous => ({ ...earlier, entries: [...(previous?.entries ?? []), ...earlier.entries, ...(page?.entries ?? [])] }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Earlier activity could not be loaded.");
    } finally {
      setPending(false);
    }
  }

  return <details open={open} onToggle={event => {
      if (event.currentTarget.open !== open) setExpanded(event.currentTarget.open);
    }} className="rounded-lg border border-border px-3 py-2">
    <summary className="cursor-pointer text-sm font-medium">
      Workflow activity{page?.completed ? ` · ${page.completed} completed` : ""}
    </summary>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}
      <button type="button" className={buttonStyles.subtle} onClick={() => setRefresh(value => value + 1)}>Refresh</button></p>}
    {!entries.length && !error && <p className="py-2 text-xs text-muted-foreground">
      {page ? "No block activity has been recorded." : "Loading activity…"}
    </p>}
    <ol className="mt-1">{entries.map(entry => <ActivityRow key={entry.id} entry={entry} />)}</ol>
    {before && <button type="button" className={buttonStyles.subtle} disabled={pending} onClick={() => void loadEarlier()}>
      {pending ? "Loading…" : "Load earlier activity"}
    </button>}
  </details>;
}
