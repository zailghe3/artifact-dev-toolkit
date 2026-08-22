"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {workflowSectionState} from "@/lib/workflow-navigation";

export function WorkflowSubnav(){const pathname=usePathname();return <nav aria-label="Workflow sections"><ul className="flex flex-wrap gap-1 border-b border-slate-300 dark:border-slate-700">{workflowSectionState(pathname).map(item=>{const active=item.active;return <li key={item.href}><Link aria-current={active?"page":undefined} className={`block rounded-t-md border-b-2 px-3 py-2 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 ${active?"border-sky-700 bg-sky-50 font-black dark:border-orange-400 dark:bg-slate-800":"border-transparent font-semibold hover:border-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"}`} href={item.href}>{item.label}</Link></li>})}</ul></nav>}
