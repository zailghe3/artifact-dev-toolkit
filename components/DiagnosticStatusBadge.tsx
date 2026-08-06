import type { DiagnosticStatusPresentation } from "@/lib/diagnostics-presentation";

const toneClasses = {
  positive: "border-emerald-600 bg-emerald-50 text-emerald-900 dark:border-emerald-400 dark:bg-emerald-950 dark:text-emerald-100",
  warning: "border-amber-600 bg-amber-50 text-amber-950 dark:border-amber-400 dark:bg-amber-950 dark:text-amber-100",
  negative: "border-red-600 bg-red-50 text-red-900 dark:border-red-400 dark:bg-red-950 dark:text-red-100",
  neutral: "border-slate-500 bg-slate-100 text-slate-900 dark:border-slate-400 dark:bg-slate-800 dark:text-slate-100",
} as const;

export function DiagnosticStatusBadge({ presentation }: { presentation: DiagnosticStatusPresentation }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${toneClasses[presentation.tone]}`}>
    <span aria-hidden="true" className="text-[.7em]">●</span><span className="sr-only">{presentation.tone} status: </span>{presentation.label}
  </span>;
}
