import Link from "next/link";
import { ArtifactEditor } from "@/components/ArtifactEditor";
import { SignOutButton } from "@/components/SignOutButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { requireRepositoryAccess } from "@/lib/auth";
export const dynamic = "force-dynamic";
export default async function NewArtifactPage() { const { session } = await requireRepositoryAccess("/artifacts/new"); return <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6"><div className="mb-5 flex items-center justify-between gap-4"><Link href="/" className="font-semibold text-sky-700 dark:text-orange-300">← Back to library</Link><div className="flex items-center gap-4"><SignOutButton login={session.login} /><ThemeToggle /></div></div><ArtifactEditor /></main>; }
