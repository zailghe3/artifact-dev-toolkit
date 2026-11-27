"use client";

import { useState } from "react";
import {buttonStyles} from "@/components/Ui";

type CopyButtonProps = { text: string | (() => Promise<string>); compact?: boolean; label?: string };

export async function copyToClipboard(text: string, clipboard: Pick<Clipboard, "writeText"> = navigator.clipboard) {
  await clipboard.writeText(text);
}

export function CopyButton({ text, compact = false, label = "artifact body" }: CopyButtonProps) {
  const [status, setStatus] = useState<"copying" | "copied" | "failed">();

  async function copy() {
    setStatus("copying");
    try {
      if (typeof text === "string") await copyToClipboard(text);
      else if (typeof ClipboardItem === "function" && navigator.clipboard?.write) {
        // Start the clipboard operation during the click, while the text is loaded asynchronously.
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": text().then(value => new Blob([value], { type: "text/plain" })) })]);
      } else await copyToClipboard(await text());
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
    window.setTimeout(() => setStatus(current => current === "copying" ? current : undefined), 1600);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${label}`}
      disabled={status === "copying"}
      className={compact?buttonStyles.subtle:buttonStyles.secondary}
    >
      {compact ? <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" /></svg> : null}
      <span aria-live="polite">
        {status === "copying" ? "Copying…" : status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : compact ? "Copy" : "Copy body"}
      </span>
    </button>
  );
}
