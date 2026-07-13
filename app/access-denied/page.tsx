import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getSession } from "@/lib/auth";
import { repositoryAccessDeniedMessages, type RepositoryAuthorizationFailureReason } from "@/lib/repository-authorization";

export const dynamic = "force-dynamic";

function getReason(value: string | undefined): RepositoryAuthorizationFailureReason {
  if (value === "allowlist" || value === "app_access" || value === "user_access" || value === "configuration" || value === "temporary_unavailable") return value;
  return "configuration";
}

export default async function AccessDeniedPage() {
  const session = await getSession();
  const reason = getReason(session?.repositoryAuthorization.denialReason);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-4 flex justify-end"><ThemeToggle /></div>
      <section className="my-auto rounded-[2rem] border border-amber-200 bg-white p-8 shadow-soft dark:border-orange-500/30 dark:bg-slate-950 sm:p-10">
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-amber-700 dark:text-orange-300">Access denied</p>
        <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-950 dark:text-slate-50 sm:text-4xl">Artifact repository authorisation is required.</h1>
        <p className="mt-4 text-base leading-7 text-slate-700 dark:text-slate-300">{repositoryAccessDeniedMessages[reason]}</p>
        <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">Signing in proves your GitHub identity, but this library also requires access to the exact configured private artifact repository through the installed GitHub App.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/sign-in" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-sky-200 dark:bg-orange-500 dark:text-slate-950 dark:hover:bg-orange-400 dark:focus:ring-orange-500/35">Sign in again</Link>
          <Link href="/" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-sky-200 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900 dark:focus:ring-orange-500/35">Back to library</Link>
        </div>
      </section>
    </main>
  );
}
