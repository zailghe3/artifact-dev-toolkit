import Link from "next/link";
import type { OperationalState as State } from "@/lib/operational-errors";

export function OperationalState({ state, diagnostics = true }: { state: State; diagnostics?: boolean }) {
  console.info(JSON.stringify({ event: "operational_state_rendered", category: state.category, status: state.status }));
  return <section className="rounded-[2rem] border border-amber-300 bg-amber-50 p-6 text-amber-950 shadow-soft dark:border-orange-500/30 dark:bg-slate-900 dark:text-orange-100">
    <p className="text-xs font-bold uppercase tracking-[0.25em]">Operational issue</p><h1 className="mt-2 text-2xl font-black">{state.title}</h1>
    <p className="mt-3">{state.explanation}</p><p className="mt-2 font-semibold">{state.guidance}</p>
    <div className="mt-5 flex gap-4">{state.retry ? <Link href="" className="font-bold underline">Retry</Link> : null}{diagnostics ? <Link href="/diagnostics" className="font-bold underline">View diagnostics</Link> : null}</div>
  </section>;
}
