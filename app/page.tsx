import { ArtifactSearch } from "@/components/ArtifactSearch";
import { SignOutButton } from "@/components/SignOutButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getArtifacts } from "@/lib/artifacts";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await requireAuth("/");
  const artifacts = await getArtifacts();
  const productionCount = artifacts.filter((artifact) => artifact.status === "production").length;

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-4 flex items-center justify-between gap-4">
        <SignOutButton login={session.login} />
        <ThemeToggle />
      </div>
      <section className="mb-8 rounded-[2rem] bg-ink p-6 text-white dark:border dark:border-orange-500/20 dark:bg-slate-950 shadow-soft sm:p-10">
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-sky-200 dark:text-orange-300">Artifact Library</p>
        <div className="mt-5 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <h1 className="text-3xl font-black tracking-tight sm:text-5xl">Find, copy, and fork workday assets fast.</h1>
            <p className="mt-3 max-w-xl text-base leading-7 text-slate-200">Reusable prompts, agents, snippets, templates, and app ideas backed by swappable storage.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-3 md:grid-cols-1">
            <div className="rounded-2xl bg-white/10 p-4"><strong className="block text-3xl">{artifacts.length}</strong><span className="text-sm text-slate-200">total</span></div>
            <div className="rounded-2xl bg-white/10 p-4"><strong className="block text-3xl">{productionCount}</strong><span className="text-sm text-slate-200">production</span></div>
          </div>
        </div>
      </section>
      <ArtifactSearch artifacts={artifacts} />
    </main>
  );
}
