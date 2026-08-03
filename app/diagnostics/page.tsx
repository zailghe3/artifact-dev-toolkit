import Link from "next/link";
import { requireDiagnosticsAccess } from "@/lib/auth";
import { generateRepositoryDiagnostics } from "@/lib/repository-diagnostics";

export const dynamic = "force-dynamic";
const badge = (value: string) => <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold uppercase dark:bg-slate-800">{value.replaceAll("_", " ")}</span>;
const yn = (value: boolean | "unknown") => value === "unknown" ? "unknown" : value ? "healthy" : "denied";
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900"><h2 className="text-lg font-black">{title}</h2><div className="mt-3 space-y-2 text-sm">{children}</div></section>; }
export default async function DiagnosticsPage() {
  const session = await requireDiagnosticsAccess(); const d = await generateRepositoryDiagnostics(session);
  return <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6"><div className="flex items-center justify-between"><div><p className="text-sm font-bold uppercase tracking-[.25em] text-sky-700 dark:text-orange-300">Protected operations</p><h1 className="text-3xl font-black">Repository diagnostics</h1></div><Link href="/" className="font-bold text-sky-700 dark:text-orange-300">← Library</Link></div><p className="mt-3 text-sm text-slate-500">Generated <time dateTime={d.generatedAt}>{d.generatedAt}</time> · Overall {badge(d.overall)}</p>
  <div className="mt-6 grid gap-4 md:grid-cols-2">
    <Section title="Signed-in identity"><p><b>Login:</b> @{d.identity.login}</p><p><b>GitHub ID:</b> {d.identity.githubId}</p>{badge("healthy")}</Section>
    <Section title="Repository configuration"><p>{d.configuration.owner ?? "—"}/{d.configuration.repository ?? "—"} · {d.configuration.branch ?? "—"}</p><p><b>Artifact root:</b> {d.configuration.artifactRoot ?? "—"}</p><p><b>Backend:</b> {d.configuration.backend} · <b>Cache binding:</b> {d.configuration.cacheBinding}</p>{Object.entries(d.configuration.authSecrets).map(([name, state]) => <p key={name}><b>{name}:</b> {state}</p>)}</Section>
    <Section title="Stored and live authorization"><p><b>Stored:</b> authorized (checked <time dateTime={d.authorization.lastCheckedAt}>{d.authorization.lastCheckedAt}</time>)</p><p><b>Repository match:</b> {String(d.authorization.repositoryMatches)}</p><p><b>Live:</b> {badge(d.authorization.liveState)}</p>{d.authorization.reason ? <p>Reason: {d.authorization.reason}</p> : null}</Section>
    <Section title="GitHub App installation"><p>{badge(d.installation.state)}</p><p>Repository ID: {d.installation.repositoryId ?? "unknown"}</p><p>Installation ID: {d.installation.installationId ?? "unknown"}</p></Section>
    <Section title="Effective permissions"><p>Contents read: {badge(yn(d.permissions.contentsRead))}</p><p>Contents write: {badge(yn(d.permissions.contentsWrite))}</p><p>Pull requests write: {badge(yn(d.permissions.pullRequestsWrite))}</p></Section>
    <Section title="Repository revision"><p>{badge(d.repositoryRevision.state)}</p><p className="font-mono">{d.repositoryRevision.value?.slice(0, 12) ?? "unknown"}</p></Section>
    <Section title="Catalogue cache"><p>{badge(d.cache.state)}</p><p>Artifacts: {d.cache.artifactCount ?? "unknown"} · Age: {d.cache.ageSeconds ?? "unknown"}s</p><p>Revision match: {String(d.cache.currentRevisionMatches ?? "unknown")}</p>{d.cache.reason ? <p>{d.cache.reason.replaceAll("_", " ")}</p> : null}</Section>
    <Section title="Artifact validation"><p>{badge(d.validation.state)}</p><p>Valid: {d.validation.validCount ?? "unknown"} · Invalid: {d.validation.invalidCount ?? "unknown"}</p>{d.validation.errors?.map((error, index) => <p key={`${error.path}-${index}`}><code>{error.path}</code>: {error.message}</p>)}</Section>
    <Section title="Recovery guidance"><p>Correct invalid configuration or files, grant the reported GitHub App permissions, and retry temporary GitHub or KV failures.</p><p>After repository content is corrected, return to the library and use its existing manual catalogue refresh control.</p></Section>
  </div></main>;
}
