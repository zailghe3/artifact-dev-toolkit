"use client";

import { useState } from "react";

type CopyButtonProps = { text: string; compact?: boolean; label?: string };

export async function copyToClipboard(text: string, clipboard: Pick<Clipboard, "writeText"> = navigator.clipboard) {
  await clipboard.writeText(text);
}

export function CopyButton({ text, compact = false, label = "artifact body" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await copyToClipboard(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${label}`}
      className={compact
        ? "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus:ring-4 focus:ring-sky-200 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus:ring-orange-500/35"
        : "rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white shadow-soft transition hover:-translate-y-0.5 hover:bg-slate-700 focus:outline-none focus:ring-4 focus:ring-sky-200 dark:bg-orange-500 dark:text-slate-950 dark:hover:bg-orange-400 dark:focus:ring-orange-500/35"}
    >
      {compact ? <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" /></svg> : null}
      {copied ? "Copied" : compact ? "Copy" : "Copy body"}
    </button>
  );
}
