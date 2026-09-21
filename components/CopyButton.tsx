"use client";

import { useState } from "react";
import {buttonStyles} from "@/components/Ui";

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
      className={compact?buttonStyles.subtle:buttonStyles.secondary}
    >
      {compact ? <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" /></svg> : null}
      {copied ? "Copied" : compact ? "Copy" : "Copy body"}
    </button>
  );
}
