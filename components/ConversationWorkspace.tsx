"use client";

import { ArrowUp, GitBranch, History, MessageSquarePlus, Pencil, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ADVISOR_WORKFLOW_ID, conversationSubmissionSchema, MAX_EXACT_TURNS,
  type ConversationCursor, type ConversationSubmission, type ConversationTarget } from "../adt-runtime/src/conversation-contract";
import { AgentToolInspector } from "@/components/AgentToolInspector";
import { ContentLoading } from "@/components/ContentLoading";
import { buttonStyles } from "@/components/Ui";
import { WorkflowApprovalAction, WorkflowRunActions } from "@/components/WorkflowRunControls";
import { WorkflowStatusBadge } from "@/components/WorkflowStatusBadge";
import { WorkflowResponse, safeResponseHref } from "@/components/WorkflowResponse";
import { conversationHref, conversationRequest, ConversationRequestError, jsonTurnRequest, type ConversationView } from "@/lib/conversation-client";
import { isTerminalTurn, type ConversationDetail, type ConversationLaunch, type ConversationList, type ConversationSummary,
  type ConversationTargetOption, type ConversationTurn } from "@/lib/conversation-types";

const listUrl = (view: ConversationView, query: string, before?: ConversationCursor) => {
  const params = new URLSearchParams({ q: query, view: view.slice(1) });
  if (before) {
    params.set("before", before.id);
    params.set("date", before.updatedAt);
  }
  return `/api/conversations?${params}`;
};

const detailUrl = (id: string, before?: number) => `/api/conversations/${id}${before ? `?before=${before}` : ""}`;
const targetKey = (target: ConversationTarget) => `${target.kind}:${target.id}`;
const textError = (error: unknown, fallback: string) => error instanceof ConversationRequestError ? error.message : fallback;
const activeItem = "bg-accent text-accent-foreground font-medium";

function ConversationHistory({ view, id, refresh }: { view: ConversationView; id?: string; refresh: number }) {
  const [query, setQuery] = useState("");
  const [list, setList] = useState<ConversationList>();
  const [error, setError] = useState("");
  const [mobileOpen, setMobileOpen] = useState(!id);
  const [more, setMore] = useState(false);
  const queryRef = useRef(query);
  const requestRef = useRef<AbortController>(null);

  useEffect(() => {
    const controller = new AbortController();
    requestRef.current = controller;
    const timer = setTimeout(() => {
      void conversationRequest<ConversationList>(listUrl(view, query), { signal: controller.signal }).then(data => {
        if (!controller.signal.aborted) { setList(data); setError(""); }
      }, failure => {
        if (!controller.signal.aborted) { setList(undefined); setError(textError(failure, "Conversation history could not be loaded.")); }
      });
    }, query ? 220 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [view, query, refresh]);

  async function loadMore() {
    if (!list?.next || more) return;
    setMore(true);
    const submittedQuery = query;
    const signal = requestRef.current?.signal;
    try {
      const next = await conversationRequest<ConversationList>(listUrl(view, submittedQuery, list.next), { signal });
      if (!signal?.aborted && queryRef.current === submittedQuery) setList(previous => ({ ...next,
        items: [...(previous?.items ?? []), ...next.items.filter(item => !previous?.items.some(current => current.id === item.id))] }));
    } catch (failure) {
      if (!signal?.aborted) setError(textError(failure, "More conversations could not be loaded."));
    } finally { setMore(false); }
  }

  return <aside aria-label="Conversation history" className="min-w-0 border-b border-border bg-muted/30 lg:border-r lg:border-b-0">
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <button type="button" className={`${buttonStyles.subtle} lg:hidden`} aria-expanded={mobileOpen} aria-controls="conversation-history"
        onClick={() => setMobileOpen(value => !value)}><History className="size-4" aria-hidden="true" />History</button>
      <h2 className="hidden text-sm font-semibold lg:block">History</h2>
      <Link className={buttonStyles.secondary} href={view} onClick={() => setMobileOpen(false)}>
        <MessageSquarePlus className="size-4" aria-hidden="true" />New conversation
      </Link>
    </div>
    <div id="conversation-history" className={`${mobileOpen ? "block" : "hidden"} px-3 pb-3 lg:block`}>
      <label className="relative block">
        <span className="sr-only">Search conversations</span>
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input type="search" className="adt-field pl-8" placeholder="Search conversations" value={query} maxLength={120}
          onChange={event => { queryRef.current = event.target.value; setQuery(event.target.value); }} />
      </label>
      {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : !list
        ? <ContentLoading label="Loading conversations" rows={2} />
        : list.items.length === 0 && <p className="px-1 pt-4 text-sm text-muted-foreground">{query ? "No matching conversations." : "No conversations yet."}</p>}
      <nav aria-label="Saved conversations" className="mt-2 max-h-64 overflow-y-auto lg:max-h-[calc(100dvh-19rem)]">
        <ul className="space-y-0.5">
          {list?.items.map(item => <li key={item.id}>
            <Link href={conversationHref(view, item.id)} onNavigate={() => setMobileOpen(false)}
              className={`block truncate rounded-md px-2.5 py-2 text-sm hover:bg-accent focus-visible:outline-ring ${id === item.id ? activeItem : ""}`}
              title={item.title} aria-current={id === item.id ? "page" : undefined}>{item.title}</Link>
          </li>)}
        </ul>
        {list?.next && <button type="button" className={buttonStyles.subtle} disabled={more}
          onClick={() => void loadMore()}>{more ? "Loading…" : "More conversations"}</button>}
      </nav>
    </div>
  </aside>;
}

function Turn({ turn, selected, onSelect, showSelection, children }: {
  turn: ConversationTurn; selected: boolean; showSelection: boolean; onSelect: () => void; children?: React.ReactNode;
}) {
  const external = turn.externalUrl && safeResponseHref(turn.externalUrl);
  return <article className="min-w-0 space-y-4" id={`turn-${turn.id}`} aria-label={`Turn ${turn.ordinal}`}>
    <div className="ml-auto max-w-[92%] space-y-1 sm:max-w-[78%]">
      <h3 className="px-1 text-right text-xs font-medium text-muted-foreground">You</h3>
      <p className="whitespace-pre-wrap wrap-anywhere rounded-2xl rounded-tr-sm bg-accent px-4 py-3 text-accent-foreground">{turn.message}</p>
    </div>
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <h3 className="font-semibold">{turn.targetName}</h3>
        <WorkflowStatusBadge status={turn.status} />
        {turn.generation > 1 && <span className="text-xs text-muted-foreground">Retry {turn.generation - 1} of this turn</span>}
        <Link href={`/workflows/runs/${turn.runId}`} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline-offset-4 hover:underline">
          <GitBranch className="size-3.5" aria-hidden="true" />Run details
        </Link>
      </div>
      {(turn.definitionChanged || turn.summaryUsed || turn.omittedHistory > 0) && <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        {turn.definitionChanged && "Execution definition updated for this turn. "}
        {turn.summaryUsed && "Earlier exchanges were summarized. "}
        {turn.omittedHistory > 0 && `${turn.omittedHistory} earlier ${turn.omittedHistory === 1 ? "exchange was" : "exchanges were"} omitted to fit the context limit.`}
      </p>}
      {turn.status === "failed" && <p role="status" className="mb-3 rounded-md border border-destructive/30 p-3 text-sm">
        {turn.failureMessage || "The Run failed."}
      </p>}
      {turn.status === "cancelled" && <p className="text-sm text-muted-foreground">This turn was cancelled.</p>}
      {turn.status === "queued" || turn.status === "running" || turn.status === "cancelling" ? <p role="status" className="text-sm text-muted-foreground">
        {turn.status === "queued" ? "Waiting for Runtime…" : turn.status === "cancelling" ? "Cancelling the Run…" : "Workflow execution is in progress…"}
      </p> : null}
      {turn.sections.length > 0 && <WorkflowResponse runId={turn.runId} sections={turn.sections} />}
      {external && <a className={`${buttonStyles.secondary} mt-3`} href={external} target="_blank" rel="noopener noreferrer">Open Run output</a>}
      {showSelection && turn.status === "succeeded" && <button type="button" aria-pressed={selected} className={`${buttonStyles.subtle} mt-2 text-xs`}
        onClick={onSelect}>{selected ? "Exact exchange selected" : "Include exact exchange in next message"}</button>}
      {children}
    </div>
  </article>;
}

function ConversationThread({ view, id, preselected, draftScope, onChanged }: {
  view: ConversationView; id?: string; preselected?: ConversationTarget; draftScope: string; onChanged: () => void;
}) {
  const router = useRouter();
  const advisor = view === "/advisor";
  const [data, setData] = useState<ConversationDetail>();
  const [targets, setTargets] = useState<ConversationTargetOption[]>();
  const [loadError, setLoadError] = useState("");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [target, setTarget] = useState(preselected ? targetKey(preselected) : "");
  const [draft, setDraft] = useState<string>();
  const [exactTurns, setExactTurns] = useState<string[]>([]);
  const [pending, setPending] = useState<ConversationSubmission>();
  const [sending, setSending] = useState(false);
  const [accepted, setAccepted] = useState<string>();
  const [error, setError] = useState("");
  const [rename, setRename] = useState<string>();
  const [renaming, setRenaming] = useState(false);
  const sendingRef = useRef(false);
  const pane = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);
  const reads = useRef<AbortController>(null);
  const draftKey = `adt:turn:${draftScope}:${id ?? `${view}:${preselected ? targetKey(preselected) : "new"}`}`;

  const reload = useCallback(async () => {
    if (!id) return;
    reads.current?.abort();
    const controller = new AbortController();
    reads.current = controller;
    try {
      const current = await conversationRequest<ConversationDetail>(detailUrl(id), { signal: controller.signal });
      if (!controller.signal.aborted) {
        setData(previous => {
          const pageStart = current.turns[0]?.ordinal;
          if (!previous || !pageStart || (previous.turns.at(-1)?.ordinal ?? 0) + 1 < pageStart) return current;
          const earlier = previous.turns.filter(turn => turn.ordinal < pageStart);
          return earlier.length ? { ...current, turns: [...earlier, ...current.turns], earlier: previous.earlier } : current;
        });
        setLoadError("");
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        if (failure instanceof ConversationRequestError && [401, 403, 404].includes(failure.status)) setData(undefined);
        setLoadError(textError(failure, "The conversation could not be loaded."));
      }
    }
  }, [id]);

  useEffect(() => {
    if (id) {
      const timer = setTimeout(() => void reload(), 0);
      return () => { clearTimeout(timer); reads.current?.abort(); };
    }
    const controller = new AbortController();
    void conversationRequest<{ targets: ConversationTargetOption[] }>(`/api/conversations/targets?view=${view.slice(1)}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setTargets(result.targets); },
        failure => { if (!controller.signal.aborted) setLoadError(textError(failure, "Execution targets could not be loaded.")); });
    return () => controller.abort();
  }, [id, reload, view]);

  useEffect(() => {
    const restore = setTimeout(() => {
      try {
        const saved = sessionStorage.getItem(draftKey);
        if (!saved) return;
        const submission = conversationSubmissionSchema.safeParse(JSON.parse(saved)).data;
        if (submission) { setPending(submission); setDraft(submission.message); setTarget(targetKey(submission.target)); }
      } catch { /* Session storage may be unavailable. */ }
    }, 0);
    return () => clearTimeout(restore);
  }, [draftKey]);

  const newest = data?.turns.at(-1);
  const active = newest && !isTerminalTurn(newest.status);
  useEffect(() => {
    if (!id) return;
    const timer = setInterval(() => { if (document.visibilityState !== "hidden") void reload(); }, active ? 2_000 : 12_000);
    return () => clearInterval(timer);
  }, [active, id, reload]);

  useEffect(() => {
    if (pinnedToBottom.current && pane.current) pane.current.scrollTop = pane.current.scrollHeight;
  }, [newest?.id, newest?.status, data?.approval?.requestId]);

  function remember(submission?: ConversationSubmission) {
    setPending(submission);
    try {
      if (submission) sessionStorage.setItem(draftKey, JSON.stringify(submission));
      else sessionStorage.removeItem(draftKey);
    } catch { /* Keep the matching request in memory when session storage is unavailable. */ }
  }

  async function loadEarlier() {
    const before = data?.earlier;
    if (!id || !before || loadingOlder) return;
    setLoadingOlder(true);
    setError("");
    try {
      const page = await conversationRequest<ConversationDetail>(detailUrl(id, before));
      pinnedToBottom.current = false;
      setData(previous => previous && previous.earlier === before ? { ...previous, turns: [...page.turns, ...previous.turns], earlier: page.earlier } : previous);
    } catch (failure) {
      setError(textError(failure, "Earlier exchanges could not be loaded."));
    } finally { setLoadingOlder(false); }
  }

  const selectedTarget = targets?.find(item => targetKey(item) === target);
  const message = draft ?? selectedTarget?.starter ?? "";
  const availableTarget = data?.conversation.target ?? selectedTarget;
  const waitingForLaunch = Boolean(accepted && (!id || data?.head.id !== accepted));
  const canSend = !waitingForLaunch && !sending && (Boolean(pending) ||
    (!active && Boolean(availableTarget) && Boolean(message.trim()) && (!id || Boolean(data))));
  async function send(event: FormEvent) {
    event.preventDefault();
    if (sendingRef.current || !canSend) return;
    const candidate = pending ?? conversationSubmissionSchema.safeParse({
      conversationId: id ?? crypto.randomUUID(), turnId: crypto.randomUUID(),
      after: data?.head ?? null, target: availableTarget && { kind: availableTarget.kind, id: availableTarget.id }, message, exactTurnIds: exactTurns,
    }).data;
    if (!candidate) { setError("Enter a message within the 64 KiB input limit."); return; }
    sendingRef.current = true;
    setSending(true);
    setError("");
    remember(candidate);
    try {
      const result = await conversationRequest<ConversationLaunch>("/api/conversations", jsonTurnRequest(candidate));
      remember();
      setDraft("");
      setExactTurns([]);
      setAccepted(result.turnId);
      onChanged();
      pinnedToBottom.current = true;
      if (!id) router.replace(conversationHref(view, result.conversationId));
      else { await reload(); setAccepted(undefined); }
    } catch (failure) {
      const rejected = failure instanceof ConversationRequestError && failure.status < 500 && failure.status !== 408 &&
        failure.status !== 429 && failure.code !== "conversation_summary_pending" &&
        !(pending && [401, 403].includes(failure.status));
      if (rejected) { remember(); if (id) void reload(); }
      setError(textError(failure, "Submission could not be confirmed. Retry this submission to check its status."));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function saveName(event: FormEvent) {
    event.preventDefault();
    if (!id || !rename?.trim() || renaming) return;
    setRenaming(true);
    setError("");
    try {
      const conversation = await conversationRequest<ConversationSummary>(detailUrl(id), jsonTurnRequest({ title: rename }, "PATCH"));
      setData(previous => previous && { ...previous, conversation });
      setRename(undefined);
      onChanged();
    } catch (failure) { setError(textError(failure, "The conversation could not be renamed.")); }
    finally { setRenaming(false); }
  }

  if (advisor && data && (data.conversation.target.kind !== "workflow" || data.conversation.target.id !== ADVISOR_WORKFLOW_ID)) {
    return <div className="p-5"><Link className={buttonStyles.secondary} href={conversationHref("/conversations", id)}>Open in Conversations</Link></div>;
  }

  const earlier = data?.earlier;
  const turns = data?.turns ?? [];
  return <section aria-label="Conversation" className="flex min-h-0 min-w-0 flex-col lg:h-[max(38rem,calc(100dvh-12rem))]">
    {id && data && <header className="flex min-w-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5 sm:px-6">
      {rename === undefined ? <>
        <h2 className="min-w-0 truncate font-semibold" title={data.conversation.title}>{data.conversation.title}</h2>
        <button type="button" title="Rename conversation" aria-label="Rename conversation" className={buttonStyles.subtle}
          onClick={() => setRename(data.conversation.title)}><Pencil className="size-4" aria-hidden="true" /></button>
      </> : <form onSubmit={saveName} className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
        <label className="min-w-44 flex-1 text-sm">Conversation title<input className="adt-field" value={rename} required maxLength={120}
          onChange={event => setRename(event.target.value)} /></label>
        <button className={buttonStyles.primary} disabled={renaming}>{renaming ? "Saving…" : "Save title"}</button>
        <button type="button" className={buttonStyles.subtle} onClick={() => setRename(undefined)} disabled={renaming}>Cancel</button>
      </form>}
    </header>}
    <div ref={pane} className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      onScroll={event => { const { scrollTop, scrollHeight, clientHeight } = event.currentTarget; pinnedToBottom.current = scrollHeight - scrollTop - clientHeight < 96; }}>
      <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6">
        {loadError && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm">{loadError}{id &&
          <button type="button" className={buttonStyles.subtle} onClick={() => void reload()}>Refresh</button>}</p>}
        {id && !data && !loadError && <ContentLoading label="Loading conversation" rows={3} />}
        {!id && <div className="mx-auto max-w-md py-10 text-center sm:py-20">
          <h2 className="text-2xl font-semibold tracking-tight">{advisor ? "Ask Advisor" : "Start a conversation"}</h2>
          {targets && targets.length === 0 && <p className="mt-3 text-sm text-muted-foreground">
            {advisor ? <>The repository has no <code>advisor</code> Workflow. <Link className="underline" href="/workflows/definitions">Open Workflow definitions</Link>.</>
              : <>Create an <Link href="/workflows/agents" className="underline">Agent</Link> or <Link href="/workflows/definitions" className="underline">Workflow</Link> before sending a message.</>}
          </p>}
          {selectedTarget && <p className="mt-2 text-sm text-muted-foreground">{selectedTarget.name} · {selectedTarget.kind === "agent" ? "Agent" : "Workflow"}</p>}
        </div>}
        {earlier && <button type="button" className={`${buttonStyles.secondary} mb-5`} disabled={loadingOlder}
          onClick={() => void loadEarlier()}>{loadingOlder ? "Loading…" : "Load earlier exchanges"}</button>}
        <div className="space-y-9">
          {turns.map(turn => <Turn key={turn.id} turn={turn} selected={exactTurns.includes(turn.id)}
            showSelection={!exactTurns.length || exactTurns.includes(turn.id) || exactTurns.length < MAX_EXACT_TURNS}
            onSelect={() => setExactTurns(keys => keys.includes(turn.id) ? keys.filter(key => key !== turn.id) : [...keys, turn.id])}>
            {turn.id === newest?.id && <>
              {data?.approval && <div className="mt-3 space-y-2 rounded-md border border-border bg-muted p-3">
                <h4 className="font-semibold">Workflow approval</h4>
                <p>{data.approval.message}</p>
                <details><summary className="cursor-pointer text-sm">Review input</summary>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap wrap-anywhere p-2 text-sm">{data.approval.reviewText}</pre>
                </details>
                <WorkflowApprovalAction runId={turn.runId} requestId={data.approval.requestId} onAction={() => void reload()} />
              </div>}
              {data?.awaitingToolReview && <AgentToolInspector runId={turn.runId} />}
              <WorkflowRunActions runId={turn.runId} status={turn.status} retryEligible={Boolean(data?.retryEligible)}
                onAction={() => void reload()} />
            </>}
          </Turn>)}
        </div>
      </div>
    </div>
    {(!id || data) && <form onSubmit={send} className="border-t border-border bg-background px-3 py-3 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {!id && !advisor && <label className="max-w-md text-sm font-medium">Agent or Workflow
          <select className="adt-field" value={target} disabled={Boolean(pending) || !targets}
            onChange={event => setTarget(event.target.value)}>
            <option value="">{targets ? "Select a target" : "Loading targets…"}</option>
            {(["agent", "workflow"] as const).map(kind => <optgroup key={kind} label={kind === "agent" ? "Agents" : "Workflows"}>
              {targets?.filter(item => item.kind === kind).map(item => <option value={targetKey(item)} key={targetKey(item)}>{item.name}</option>)}
            </optgroup>)}
          </select>
        </label>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {pending && !sending && <p className="text-sm text-muted-foreground">Retry uses the same submission so any accepted Run can be recovered.</p>}
        {exactTurns.length > 0 && <p className="text-xs text-muted-foreground">{exactTurns.length} exact {exactTurns.length === 1 ? "exchange" : "exchanges"} selected for the next message.</p>}
        <div className="flex min-w-0 items-end gap-2 rounded-xl border border-border bg-card px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
          <label className="min-w-0 flex-1">
            <span className="sr-only">{id ? "Follow-up message" : "Message"}</span>
            <textarea className="block max-h-72 min-h-12 w-full resize-y rounded-lg bg-transparent px-2 py-2 text-sm outline-none"
              rows={2} maxLength={65_536} value={pending?.message ?? message} onChange={event => setDraft(event.target.value)}
              disabled={Boolean(pending) || waitingForLaunch} placeholder={id ? "Ask a follow-up…" : "Enter a message…"}
              onKeyDown={event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) event.currentTarget.form?.requestSubmit(); }} />
          </label>
          <button type="submit" className={buttonStyles.primary} aria-label={pending ? "Retry submission" : "Send message"}
            aria-busy={sending} disabled={!canSend}>
            <ArrowUp aria-hidden="true" className="size-4" />{sending ? "Sending…" : pending ? "Retry submission" : "Send"}
          </button>
        </div>
        {active && <p className="text-xs text-muted-foreground">You can send a follow-up when this turn finishes.</p>}
      </div>
    </form>}
  </section>;
}

export function ConversationWorkspace({ view, id, preselected, draftScope }: {
  view: ConversationView; id?: string; preselected?: ConversationTarget; draftScope: string;
}) {
  const [refresh, setRefresh] = useState(0);
  const advisor = view === "/advisor";
  return <div className="mx-auto max-w-[90rem]">
    <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{advisor ? "Advisor" : "Conversations"}</h1>
      <Link className={buttonStyles.subtle} href={advisor ? "/advisor/knowledge" : "/workflows/runs"}>{advisor ? "Knowledge library" : "Run history"}</Link>
    </header>
    <div className="grid min-w-0 overflow-hidden rounded-xl border border-border bg-background lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)]">
      <ConversationHistory view={view} id={id} refresh={refresh} />
      <ConversationThread key={id ?? (preselected ? targetKey(preselected) : "new")} view={view} id={id} preselected={preselected}
        draftScope={draftScope} onChanged={() => setRefresh(value => value + 1)} />
    </div>
  </div>;
}
