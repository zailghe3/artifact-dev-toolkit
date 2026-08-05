import { AppHeader } from "@/components/AppHeader";
import { CatalogueRefresh } from "@/components/CatalogueRefresh";
import { requireDiagnosticsAccess } from "@/lib/auth";
import { generateRepositoryDiagnostics } from "@/lib/repository-diagnostics";

export const dynamic = "force-dynamic";
const badge = (value: string) => <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold uppercase dark:bg-slate-800">{value.replaceAll("_", " ")}</span>;
const permission = (value: { effective: boolean | "unknown"; reason: string }) => `${value.effective === "unknown" ? "unknown" : value.effective ? "granted" : "denied"} · ${value.reason.replaceAll("_", " ")}`;
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900"><h2 className="text-lg font-black">{title}</h2><div className="mt-3 space-y-2 text-sm">{children}</div></section>; }
export default async function DiagnosticsPage() {
  const session = await requireDiagnosticsAccess(); const d = await generateRepositoryDiagnostics(session);
  return <><AppHeader login={session.login} currentPath="/diagnostics" /><main className="mx-auto min-h-screen max-w-5xl px-4 py-6 sm:px-6"><div><p className="text-sm font-bold uppercase tracking-[.25em] text-sky-700 dark:text-orange-300">Protected operations</p><h1 className="text-3xl font-black">Repository diagnostics</h1></div><p className="mt-3 text-sm text-slate-500">Generated <time dateTime={d.generatedAt}>{d.generatedAt}</time> · Overall {badge(d.overall)}</p>
  <section aria-labelledby="catalogue-health-heading" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900">
    <h2 id="catalogue-health-heading" className="text-lg font-black">Catalogue health</h2>
    <div className="mt-3 space-y-3 text-sm">
      <p>Catalogue state: {badge(d.cache.state)}</p>
      <p>Last successful refresh: {d.cache.refreshedAt ? <time dateTime={d.cache.refreshedAt}>{d.cache.refreshedAt}</time> : "unknown"}</p>
      <CatalogueRefresh refreshedAt={d.cache.refreshedAt ?? d.generatedAt} cacheState={d.cache.state === "fresh" || d.cache.state === "stale" || d.cache.state === "degraded" ? d.cache.state : "refreshed"} />
    </div>
  </section>
  <div className="mt-6 grid gap-4 md:grid-cols-2">
    <Section title="Signed-in identity"><p><b>Login:</b> @{d.identity.login}</p><p><b>GitHub ID:</b> {d.identity.githubId}</p>{badge("healthy")}</Section>
    <Section title="Repository configuration"><p>{d.configuration.owner ?? "—"}/{d.configuration.repository ?? "—"} · {d.configuration.branch ?? "—"}</p><p><b>Artifact root:</b> {d.configuration.artifactRoot ?? "—"}</p><p><b>Backend:</b> {d.configuration.backend} · <b>Cache binding:</b> {d.configuration.cacheBinding}</p>{Object.entries(d.configuration.authSecrets).map(([name, state]) => <p key={name}><b>{name}:</b> {state}</p>)}</Section>
    <Section title="Stored and live authorization"><p><b>Stored:</b> authorized (checked <time dateTime={d.authorization.lastCheckedAt}>{d.authorization.lastCheckedAt}</time>)</p><p><b>Repository match:</b> {String(d.authorization.repositoryMatches)}</p><p><b>Live:</b> {badge(d.authorization.liveState)}</p>{d.authorization.reason ? <p>Reason: {d.authorization.reason}</p> : null}</Section>
    <Section title="GitHub App installation"><p>{badge(d.installation.state)}</p><p>Repository ID: {d.installation.repositoryId ?? "unknown"}</p><p>Installation ID: {d.installation.installationId ?? "unknown"}</p></Section>
    <Section title="Effective permissions"><p>Contents read: {badge(permission(d.permissions.contentsRead))}</p><p>Contents write: {badge(permission(d.permissions.contentsWrite))}</p><p>Pull requests write: {badge(permission(d.permissions.pullRequestsWrite))}</p></Section>
    <Section title="Repository revision"><p>{badge(d.repositoryRevision.state)}</p><p className="font-mono">{d.repositoryRevision.value?.slice(0, 12) ?? "unknown"}</p></Section>
    <Section title="Catalogue cache"><p>{badge(d.cache.state)}</p><p>Artifacts: {d.cache.artifactCount ?? "unknown"} · Age: {d.cache.ageSeconds ?? "unknown"}s</p><p>Revision match: {String(d.cache.currentRevisionMatches ?? "unknown")}</p>{d.cache.reason ? <p>{d.cache.reason.replaceAll("_", " ")}</p> : null}</Section>
    <Section title="Artifact validation"><p>{badge(d.validation.state)}</p><p>Valid: {d.validation.validCount ?? "unknown"} · Invalid: {d.validation.invalidCount ?? "unknown"}</p>{d.validation.errors?.map((error, index) => <p key={`${error.path}-${index}`}><code>{error.path}</code>: {error.message}</p>)}</Section>
    <Section title="Recovery guidance"><p>Correct invalid configuration or files, grant the reported GitHub App permissions, and retry temporary GitHub or KV failures.</p><p>Use the Catalogue health controls on this page to refresh or fully rebuild catalogue data after repository content is corrected.</p></Section>
  </div></main></>;
}
