"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { buttonStyles } from "./Ui";
import { PendingButtonContent } from "./PendingButtonContent";

export function ArtifactValidationAction({ completed = false }: { completed?: boolean }) {
  const router = useRouter(), searchParams = useSearchParams();
  const [pending, setPending] = useState(false);
  function run() { setPending(true); const next = new URLSearchParams(searchParams); next.set("validation", "run"); router.push(`/diagnostics?${next}#artifact-library`); }
  return <section className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"><h3 className="font-black">Active repository diagnostic</h3><p className="mt-2 text-sm">Validation reads and validates the current repository snapshot only when requested. Its result updates Artifact Library and overall health.</p><button type="button" className={`${buttonStyles.secondary} mt-3`} disabled={pending} aria-busy={pending} onClick={run}><PendingButtonContent pending={pending}>{pending ? "Validating…" : completed ? "Validate artifacts again" : "Validate artifacts"}</PendingButtonContent></button></section>;
}
