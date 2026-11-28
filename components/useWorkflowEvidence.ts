"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  EvidenceChanged, initialEvidenceWindow, reconcileEvidenceWindow,
  type EvidencePage, type EvidencePosition, type EvidenceWindow,
} from "@/lib/workflow-evidence-window";

export function useWorkflowEvidence<Entry, Cursor extends EvidencePosition, Page extends EvidencePage<Entry, Cursor>>(
  initial: Page | undefined,
  load: (before: Cursor | undefined, signal: AbortSignal) => Promise<Page>,
  position: (entry: Entry) => Cursor,
  compare: (left: Cursor, right: Cursor) => number,
) {
  type Window = EvidenceWindow<Entry, Cursor, Page>;
  const [window, setWindow] = useState<Window | undefined>(() => initial ? initialEvidenceWindow<Entry, Cursor, Page>(initial) : undefined);
  const current = useRef(window);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const lifecycle = useRef<AbortController>(null);
  const queue = useRef(Promise.resolve());
  const paging = useRef(false);
  const refreshing = useRef(false);
  const queuedRefresh = useRef<{ page?: Page; signal: AbortSignal } | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    return () => controller.abort();
  }, []);

  const enqueue = useCallback((operation: (signal: AbortSignal) => Promise<void>, signal: AbortSignal) => {
    const task = queue.current.then(async () => {
      if (signal.aborted) return;
      try {
        await operation(signal);
        if (!signal.aborted) setError("");
      } catch (failure) {
        if (!signal.aborted) setError(failure instanceof Error ? failure.message : "Run history is unavailable.");
      }
    });
    queue.current = task;
    return task;
  }, []);

  const commit = useCallback((next: Window, signal: AbortSignal) => {
    if (signal.aborted) return;
    current.current = next;
    setWindow(next);
  }, []);

  const readWindow = useCallback(async (initialHead: Page, through: Cursor | null, signal: AbortSignal): Promise<Window> => {
    let head = initialHead;
    for (let retry = 0; ; retry++) {
      try {
        return await reconcileEvidenceWindow(head, through, before => load(before, signal), position, compare);
      } catch (failure) {
        if (!(failure instanceof EvidenceChanged)) throw failure;
        if (retry === 2) throw new Error("Run history changed while loading. Refresh to try again.");
        head = await load(undefined, signal);
      }
    }
  }, [load, position, compare]);

  const refresh = useCallback((page?: Page) => {
    const signal = lifecycle.current?.signal;
    if (!signal || signal.aborted) return;
    queuedRefresh.current = { page, signal };
    if (refreshing.current) return;
    refreshing.current = true;
    async function drain() {
      while (queuedRefresh.current) {
        const next = queuedRefresh.current;
        queuedRefresh.current = undefined;
        await enqueue(async signal => {
          const head = next.page ?? await load(undefined, signal);
          const previous = current.current;
          if (!previous) commit(initialEvidenceWindow<Entry, Cursor, Page>(head), signal);
          else if (head !== previous.head && (!head.observedAt || !previous.head.observedAt || head.observedAt >= previous.head.observedAt)) {
            const unchanged = head.revision && previous.head.revision === head.revision;
            commit(unchanged ? { ...previous, head } : await readWindow(head, previous.before, signal), signal);
          }
        }, next.signal);
      }
      refreshing.current = false;
    }
    void drain();
  }, [enqueue, commit, load, readWindow]);

  const loadEarlier = useCallback(async () => {
    const signal = lifecycle.current?.signal;
    if (!signal || signal.aborted || paging.current) return;
    paging.current = true;
    setPending(true);
    try {
      await enqueue(async signal => {
        const previous = current.current;
        if (!previous?.before) return;
        const earlier = await load(previous.before, signal);
        if (earlier.before && compare(earlier.before, previous.before) >= 0) throw new Error("The Run history cursor did not advance.");
        if (earlier.revision && earlier.revision === previous.head.revision) {
          const entries = new Map([...earlier.entries, ...previous.entries].map(entry => [position(entry).id, entry]));
          commit({ ...previous, entries: [...entries.values()], before: earlier.before }, signal);
        } else {
          commit(await readWindow(await load(undefined, signal), earlier.before, signal), signal);
        }
      }, signal);
    } finally {
      paging.current = false;
      if (!signal.aborted) setPending(false);
    }
  }, [enqueue, load, position, compare, readWindow, commit]);

  return { window, pending, error, refresh, loadEarlier };
}
