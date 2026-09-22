"use client";
import { useState } from "react";
import { buttonStyles } from "./Ui";
import { PendingButtonContent } from "./PendingButtonContent";
import type { RepositoryDiagnostics } from "@/lib/repository-diagnostics";

export function ArtifactValidationAction() {
  const [pending, setPending] = useState(false);
  const [validation, setValidation] = useState<RepositoryDiagnostics["validation"]>();
  const [error, setError] = useState("");
  async function run() { setPending(true); setError(""); try { const response = await fetch("/api/diagnostics/repository", { cache: "no-store" }); if (!response.ok) throw new Error(); setValidation((await response.json() as RepositoryDiagnostics).validation); } catch { setError("Artifact validation is unavailable. Previously observed catalogue status is unchanged."); } finally { setPending(false); } }
  return <section className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"><h3 className="font-black">Active repository diagnostic</h3><p className="mt-2 text-sm">Validation reads and validates the current repository snapshot only when requested.</p><button type="button" className={`${buttonStyles.secondary} mt-3`} disabled={pending} aria-busy={pending} onClick={() => void run()}><PendingButtonContent pending={pending}>{pending ? "Validating…" : "Validate artifacts"}</PendingButtonContent></button>{error ? <p role="alert" className="mt-3">{error}</p> : null}{validation ? <p role="status" className="mt-3 font-semibold">Validation {validation.state}. Valid: {validation.validCount ?? "unknown"}; invalid: {validation.invalidCount ?? "unknown"}.</p> : null}</section>;
}
