"use client";
import { useState } from "react";
import { buildDiagnosticReport, type SafeDiagnosticReportInput } from "@/lib/diagnostic-reports";
import { buttonStyles } from "./Ui";

export function DiagnosticCopyActions({ report }: { report: SafeDiagnosticReportInput }) {
  const [message, setMessage] = useState("");
  async function copy(kind: "summary" | "technical") {
    try { const built = buildDiagnosticReport(report); await navigator.clipboard.writeText(kind === "summary" ? built.summary : built.technical); setMessage(`${kind === "summary" ? "Summary" : "Technical details"} copied.`); }
    catch { setMessage("Could not copy diagnostics. Check clipboard permission and try again."); }
  }
  return <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700"><p className="text-xs text-slate-600 dark:text-slate-300">Safe to share — credential and secret values are excluded.</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" className={buttonStyles.secondary} onClick={() => void copy("summary")}>Copy summary</button><button type="button" className={buttonStyles.secondary} onClick={() => void copy("technical")}>Copy technical details</button></div><p className="mt-2 text-sm" role="status" aria-live="polite">{message}</p></div>;
}
