import Link from "next/link";
import { ArtifactEditor } from "@/components/ArtifactEditor";
import { requireRepositoryAccess } from "@/lib/auth";
export const dynamic = "force-dynamic";
export default async function NewArtifactPage() { await requireRepositoryAccess("/artifacts/new"); return <main className="mx-auto min-h-screen max-w-4xl px-4 py-8"><Link href="/" className="mb-5 inline-block font-semibold text-sky-700">← Back to library</Link><ArtifactEditor /></main>; }
