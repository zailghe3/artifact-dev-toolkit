import { AppHeader } from "@/components/AppHeader";
import { CatalogueRefreshControls } from "@/components/CatalogueRefresh";
import { CatalogueHealthSummary } from "@/components/CatalogueHealthSummary";
import { DiagnosticStatusBadge } from "@/components/DiagnosticStatusBadge";
import { LocalizedTime } from "@/components/LocalizedTime";
import { catalogueRefreshAvailability } from "@/lib/diagnostics-model";
import { authorizationStatusPresentation, cacheStatusPresentation, configurationStatusPresentation, diagnosticContributors, installationStatusPresentation, overallStatusPresentation, permissionStatusPresentation, repositoryMatchPresentation, revisionStatusPresentation, validationStatusPresentation } from "@/lib/diagnostics-presentation";
import { requireDiagnosticsAccess } from "@/lib/auth";
import { generateRepositoryDiagnostics } from "@/lib/repository-diagnostics";

export const dynamic = "force-dynamic";
function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) { return <section id={id} className="scroll-mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900"><h2 className="text-lg font-black">{title}</h2><div className="mt-3 space-y-2 text-sm">{children}</div></section>; }
function Status({ label, presentation }: { label?: string; presentation: Parameters<typeof DiagnosticStatusBadge>[0]["presentation"] }) { return <span className="inline-flex flex-wrap items-center gap-2">{label ? <b>{label}:</b> : null}<DiagnosticStatusBadge presentation={presentation} /></span>; }

export default async function DiagnosticsPage() {
  const session = await requireDiagnosticsAccess();
  const d = await generateRepositoryDiagnostics(session);
  const refreshAvailability = catalogueRefreshAvailability(d);
  const overall = overallStatusPresentation(d.overall);
  const contributorSummary = diagnosticContributors(d);
  return <><AppHeader login={session.login} currentPath="/diagnostics" /><main className="mx-auto min-h-screen max-w-5xl px-4 py-6 sm:px-6">
    <p className="text-sm font-bold uppercase tracking-[.25em] text-sky-700 dark:text-orange-300">Protected operations</p><h1 className="text-3xl font-black">Repository diagnostics</h1>
    <section aria-labelledby="overall-heading" className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2"><h2 id="overall-heading" className="text-lg font-black">Overall status:</h2><DiagnosticStatusBadge presentation={overall} /></div>
      <p className="mt-2 text-sm">{overall.description}</p>
      {contributorSummary.contributors.length ? <div className="mt-4"><h3 className="font-bold">Needs attention</h3><ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{contributorSummary.contributors.map(item => <li key={item.id}><a className="underline decoration-1 underline-offset-2" href={item.href}>{item.message}</a></li>)}</ul>{contributorSummary.omittedCount ? <p className="mt-2 text-sm">And {contributorSummary.omittedCount} more diagnostic {contributorSummary.omittedCount === 1 ? "check" : "checks"}.</p> : null}</div> : null}
      <p className="mt-4 text-xs text-slate-500">Generated <LocalizedTime value={d.generatedAt} /></p>
    </section>
    <section aria-labelledby="catalogue-health-heading" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900"><h2 id="catalogue-health-heading" className="text-lg font-black">Catalogue health</h2><div className="mt-3 flex flex-wrap items-start justify-between gap-4 text-sm"><CatalogueHealthSummary cache={d.cache} /><CatalogueRefreshControls availability={refreshAvailability} /></div></section>
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      <Section id="identity" title="Signed-in identity"><Status presentation={{ label: "Valid session", tone: "positive" }} /><p><b>Login:</b> @{d.identity.login}</p><p><b>GitHub ID:</b> {d.identity.githubId}</p></Section>
      <Section id="repository-configuration" title="Repository configuration"><p>{d.configuration.owner ?? "—"}/{d.configuration.repository ?? "—"} · {d.configuration.branch ?? "—"}</p><p><b>Artifact root:</b> {d.configuration.artifactRoot ?? "—"}</p><Status label="Cache binding" presentation={configurationStatusPresentation(d.configuration.cacheBinding)} />{Object.entries(d.configuration.authSecrets).map(([name, state]) => <p key={name}><Status label={name} presentation={configurationStatusPresentation(state)} /></p>)}</Section>
      <Section id="authorization" title="Stored and live authorization"><p><Status label="Stored" presentation={authorizationStatusPresentation(d.authorization.storedState)} /> <span className="text-slate-500">checked <LocalizedTime value={d.authorization.lastCheckedAt} /></span></p><p><Status label="Repository" presentation={repositoryMatchPresentation(d.authorization.repositoryMatches)} /></p><p><Status label="Live" presentation={authorizationStatusPresentation(d.authorization.liveState)} /></p></Section>
      <Section id="installation" title="GitHub App installation"><DiagnosticStatusBadge presentation={installationStatusPresentation(d.installation.state)} /><p>Repository ID: {d.installation.repositoryId ?? "unknown"}</p><p>Installation ID: {d.installation.installationId ?? "unknown"}</p></Section>
      <Section id="permissions" title="Effective permissions"><p><Status label="Contents read" presentation={permissionStatusPresentation(d.permissions.contentsRead)} /></p><p id="permissions-write"><Status label="Contents write" presentation={permissionStatusPresentation(d.permissions.contentsWrite)} /></p><div id="permissions-proposal"><Status label="Production proposals" presentation={permissionStatusPresentation(d.permissions.pullRequestsWrite)} /><p className="mt-1 text-slate-600 dark:text-slate-300">Requires Contents write + Pull requests write.</p>{permissionStatusPresentation(d.permissions.pullRequestsWrite).description ? <p className="mt-1">{permissionStatusPresentation(d.permissions.pullRequestsWrite).description}</p> : null}</div>{d.permissions.checkedAt ? <p className="text-slate-500">Checked <LocalizedTime value={d.permissions.checkedAt} /></p> : null}</Section>
      <Section id="repository-revision" title="Repository revision"><DiagnosticStatusBadge presentation={revisionStatusPresentation(d.repositoryRevision.state)} /><p className="font-mono">{d.repositoryRevision.value?.slice(0, 12) ?? "unknown"}</p></Section>
      <Section id="catalogue-cache" title="Catalogue cache"><DiagnosticStatusBadge presentation={cacheStatusPresentation(d.cache.state)} /><p>Artifacts: {d.cache.artifactCount ?? "unknown"} · Age: {d.cache.ageSeconds ?? "unknown"}s</p><p>Revision match: {String(d.cache.currentRevisionMatches ?? "unknown")}</p><p>Last successful refresh: {d.cache.refreshedAt ? <LocalizedTime value={d.cache.refreshedAt} /> : "unknown"}</p></Section>
      <Section id="artifact-validation" title="Artifact validation"><DiagnosticStatusBadge presentation={validationStatusPresentation(d.validation.state)} /><p>Valid: {d.validation.validCount ?? "unknown"} · Invalid: {d.validation.invalidCount ?? "unknown"}</p>{d.validation.errors?.map((error, index) => <p key={`${error.path}-${index}`}><code>{error.path}</code>: {error.message}</p>)}</Section>
      <Section id="recovery" title="Recovery guidance"><p>Correct invalid configuration or files, grant the reported GitHub App permissions, and retry temporary GitHub or KV failures.</p><p>Use the Catalogue health controls on this page to refresh or fully rebuild catalogue data after repository content is corrected.</p></Section>
    </div>
  </main></>;
}
