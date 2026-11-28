import type { ActivityCursor } from "./workflow-run-activity.ts";
import type { RunContentCursor } from "./workflow-run-content.ts";

export type EvidencePosition = { id: string };
export type EvidencePage<Entry, Cursor> = { entries: Entry[]; before: Cursor | null; revision?: string; observedAt?: string };
export type EvidenceWindow<Entry, Cursor, Page extends EvidencePage<Entry, Cursor>> = {
  head: Page; entries: Entry[]; before: Cursor | null;
};

export const compareEvidenceId = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
export const compareContentPosition = (left: RunContentCursor, right: RunContentCursor) =>
  left.sequence - right.sequence || compareEvidenceId(left.id, right.id);

// The Runtime cursors carry the database's full timestamp precision. Older
// activity summaries had millisecond precision, so normalise those on input.
const comparableTime = (at: string) => at.replace(/(?:\.(\d+))?Z$/, (_, fraction?: string) => `.${(fraction ?? "").padEnd(6, "0")}Z`);
export const compareActivityPosition = (left: ActivityCursor, right: ActivityCursor) =>
  compareEvidenceId(comparableTime(left.at), comparableTime(right.at)) || compareEvidenceId(left.id, right.id);

export class EvidenceChanged extends Error {}

export function initialEvidenceWindow<Entry, Cursor, Page extends EvidencePage<Entry, Cursor>>(head: Page) {
  return { head, entries: head.entries, before: head.before };
}

/**
 * Re-read everything that was visible, following cursors from the new head.
 * An unbounded lower edge means the previous view had reached the beginning.
 */
export async function reconcileEvidenceWindow<Entry, Cursor extends EvidencePosition, Page extends EvidencePage<Entry, Cursor>>(
  head: Page,
  through: Cursor | null,
  readEarlier: (before: Cursor) => Promise<Page>,
  position: (entry: Entry) => Cursor,
  compare: (left: Cursor, right: Cursor) => number,
): Promise<EvidenceWindow<Entry, Cursor, Page>> {
  const entries = new Map<string, Entry>();
  let page = head;
  let hasEarlier = false;
  for (;;) {
    for (const entry of page.entries) {
      const key = position(entry);
      if (through && compare(key, through) < 0) hasEarlier = true;
      else if (!entries.has(key.id)) entries.set(key.id, entry);
    }
    const cursor = page.before;
    if (!cursor) break;
    if (through && compare(cursor, through) <= 0) {
      hasEarlier = true;
      break;
    }
    page = await readEarlier(cursor);
    if (head.revision && head.revision !== page.revision) throw new EvidenceChanged();
    if (page.before && compare(page.before, cursor) >= 0) throw new Error("The Run history cursor did not advance.");
  }
  return { head, entries: [...entries.values()], before: hasEarlier ? through : null };
}
