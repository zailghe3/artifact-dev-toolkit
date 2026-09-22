"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { SafeCodexConnectionStatus } from "@/lib/codex-runner-status";
import { buttonStyles } from "./Ui";
import { PendingButtonContent } from "./PendingButtonContent";
import { codexRunnerFailureFeedback, type CodexRunnerFeedback } from "@/lib/codex-runner-feedback";

type Ceremony = { loginId: string; verificationUrl: string; userCode: string };
const MAX_ERROR_BYTES = 4096;
async function safeFailure(response: Response, operation: "connect" | "refresh" | "logout"): Promise<CodexRunnerFeedback> {
  let value: Record<string, unknown> = {};
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  const text = Number.isFinite(declaredLength) && declaredLength <= MAX_ERROR_BYTES ? await response.text() : "";
  if (new Blob([text]).size <= MAX_ERROR_BYTES) try { value = JSON.parse(text); } catch { /* Use the bounded generic mapping. */ }
  return codexRunnerFailureFeedback(response.status, value, operation, window.location.origin);
}
export function CodexRunnerConnection({ initialStatus }: { initialStatus: SafeCodexConnectionStatus }) {
  const [status, setStatus] = useState(initialStatus), [ceremony, setCeremony] = useState<Ceremony>(), [feedback, setFeedback] = useState<CodexRunnerFeedback>(), [pending, setPending] = useState<"connect" | "logout">();
  async function refresh() { try { const response = await fetch("/api/workflow-connections/codex-runner/status", { cache: "no-store" }); if (!response.ok) { setFeedback(await safeFailure(response, "refresh")); return; } const next = await response.json() as SafeCodexConnectionStatus; setStatus(next); setFeedback(undefined); if (next.state === "connected") setCeremony(undefined); } catch { setFeedback({ message: "Runner status could not be refreshed." }); } }
  useEffect(() => { if (!ceremony) return; const timer = setInterval(() => void refresh(), 3000); return () => clearInterval(timer); }, [ceremony]);
  async function connect() { setPending("connect"); setFeedback(undefined); try { const response = await fetch("/api/workflow-connections/codex-runner/device", { method: "POST" }); if (!response.ok) { setFeedback(await safeFailure(response, "connect")); return; } setCeremony(await response.json()); setFeedback(undefined); setStatus({ ...status, state: "waiting", label: "Waiting for device authorization" }); } catch { setFeedback({ message: "Codex Runner is unavailable. Try again." }); } finally { setPending(undefined); } }
  async function logout() { setPending("logout"); setFeedback(undefined); try { const response = await fetch("/api/workflow-connections/codex-runner/logout", { method: "POST" }); if (!response.ok) { setFeedback(await safeFailure(response, "logout")); return; } setCeremony(undefined); await refresh(); } catch { setFeedback({ message: "ChatGPT could not be disconnected. Try again." }); } finally { setPending(undefined); } }
  const needsAttention = status.state === "unavailable" || status.state === "update-required";
  return <article className="mt-6 adt-panel"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">Codex Runner</h2><p className="mt-1">Self-hosted Codex runtime connection</p></div><span className="rounded-full border px-2 py-1 text-sm font-semibold">{status.label}</span></div>{status.capabilities ? <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 text-sm"><dt>Coding jobs</dt><dd>{status.capabilities.jobExecution ? "Supported" : "Not supported by this Runner"}</dd></dl> : null}{feedback ? <div role="alert" className="mt-4 rounded border p-3"><p>{feedback.message}</p>{feedback.signInUrl ? <a className="mt-2 inline-block underline" href={feedback.signInUrl}>Sign in</a> : null}</div> : null}{ceremony ? <div className="mt-4 rounded border p-3">Open <a className="underline" href={ceremony.verificationUrl} target="_blank" rel="noreferrer">{ceremony.verificationUrl}</a> and enter: <code>{ceremony.userCode}</code></div> : null}<div className="mt-4 flex flex-wrap gap-2">{status.state === "disconnected" ? <button className={buttonStyles.primary} disabled={Boolean(pending)} onClick={() => void connect()}><PendingButtonContent pending={pending === "connect"}>{pending === "connect" ? "Connecting…" : "Connect ChatGPT"}</PendingButtonContent></button> : null}{status.state === "connected" ? <button className={buttonStyles.danger} disabled={Boolean(pending)} onClick={() => void logout()}><PendingButtonContent pending={pending === "logout"}>{pending === "logout" ? "Disconnecting…" : "Disconnect / Logout"}</PendingButtonContent></button> : null}<Link className={buttonStyles.secondary} href="/diagnostics#codex-runner">Diagnostics &amp; maintenance</Link></div>{needsAttention ? <p className="mt-3 text-sm font-semibold">Operational attention is required. Use Diagnostics &amp; maintenance for compatibility, probes, job history, and recovery.</p> : null}</article>;
}
