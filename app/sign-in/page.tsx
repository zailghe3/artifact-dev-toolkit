import Link from "next/link";
import { createOAuthStart, getSession } from "@/lib/auth";
import { safeReturnTo } from "@/lib/auth-core";
import { ThemeToggle } from "@/components/ThemeToggle";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; error?: string }> }) {
  const params = await searchParams;
  const session = await getSession();
  const returnTo = safeReturnTo(params.returnTo);
  if (session) redirect(returnTo);
  const authorizeUrl = await createOAuthStart(returnTo);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-4 flex justify-end"><ThemeToggle /></div>
      <section className="my-auto rounded-[2rem] border border-slate-200 bg-white p-8 text-center shadow-soft dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-sky-700 dark:text-orange-300">Artifact Library</p>
        <h1 className="mt-4 text-4xl font-black tracking-tight text-slate-950 dark:text-slate-50">Sign in required</h1>
        <p className="mt-3 text-slate-600 dark:text-slate-300">Sign in with GitHub to access artifact metadata, content, and protected APIs.</p>
        {params.error ? <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">{params.error}</p> : null}
        <Link href={authorizeUrl.toString()} className="mt-6 inline-flex rounded-full bg-slate-950 px-6 py-3 text-sm font-bold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-sky-200 dark:bg-orange-500 dark:text-slate-950 dark:hover:bg-orange-400 dark:focus:ring-orange-500/35">Sign in with GitHub</Link>
      </section>
    </main>
  );
}
