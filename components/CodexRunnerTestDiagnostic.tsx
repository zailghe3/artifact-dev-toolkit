"use client";
import { useState } from "react";
import { buttonStyles } from "./Ui";
import { PendingButtonContent } from "./PendingButtonContent";
import type { CodexTestFailureReason } from "@/lib/codex-runner-client";

const failures: Record<CodexTestFailureReason, string> = { codex_not_connected: "Connect ChatGPT before testing Codex.", app_server_unavailable: "Codex App Server is unavailable.", thread_start_failed: "Codex could not start the isolated test.", turn_start_failed: "Codex could not start the model turn.", turn_failed: "The Codex model turn failed.", timeout: "The Codex test timed out.", unexpected_output: "Codex returned an unexpected response.", unexpected_tool_activity: "Codex attempted tool activity; the test was stopped.", test_in_progress: "A Codex test is already in progress." };
export function CodexRunnerTestDiagnostic() {
  const [pending, setPending] = useState(false), [message, setMessage] = useState("");
  async function run() { setPending(true); setMessage(""); try { const response = await fetch("/api/workflow-connections/codex-runner/test", { method: "POST" }), value = await response.json() as Record<string, unknown>; if (response.ok && value.ok === true && Object.keys(value).length === 2 && Number.isInteger(value.durationMs) && Number(value.durationMs) >= 0 && Number(value.durationMs) <= 60000) setMessage(`Codex test passed · ${(Number(value.durationMs) / 1000).toFixed(1)} s`); else if (value.ok === false && typeof value.reason === "string" && value.reason in failures) setMessage(failures[value.reason as CodexTestFailureReason]); else setMessage("Codex test returned an invalid response."); } catch { setMessage("Codex test is unavailable."); } finally { setPending(false); } }
  return <section className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"><h3 className="font-black">Active diagnostic</h3><p className="mt-2 text-sm">Runs the existing bounded Codex functional test. No browser prompt is forwarded and unexpected tool activity fails safely.</p><button className={`${buttonStyles.secondary} mt-3`} disabled={pending} aria-busy={pending} onClick={() => void run()}><PendingButtonContent pending={pending}>{pending ? "Testing Codex…" : "Test Codex"}</PendingButtonContent></button><p className="mt-3 text-sm" role="status" aria-live="polite">{message}</p></section>;
}
