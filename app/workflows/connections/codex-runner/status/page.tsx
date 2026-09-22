import { redirect } from "next/navigation";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const input = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) if (typeof value === "string") query.set(key, value);
  redirect(`/diagnostics${query.size ? `?${query}` : ""}#codex-runner`);
}
