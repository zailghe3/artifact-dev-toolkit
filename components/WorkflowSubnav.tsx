"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";

const sections=[
  {label:"Overview",href:"/workflows",matches:(path:string)=>path==="/workflows"},
  {label:"Runs",href:"/workflows/runs",matches:(path:string)=>path==="/workflows/runs"||path.startsWith("/workflows/runs/")},
  {label:"Workflows",href:"/workflows/definitions",matches:(path:string)=>path==="/workflows/definitions"||path.startsWith("/workflows/definitions/")},
  {label:"Agents",href:"/workflows/agents",matches:(path:string)=>path==="/workflows/agents"||path.startsWith("/workflows/agents/")},
  {label:"Connections",href:"/workflows/connections",matches:(path:string)=>path==="/workflows/connections"||path.startsWith("/workflows/connections/")},
  {label:"Codex environments",href:"/workflows/codex-environments",matches:(path:string)=>path==="/workflows/codex-environments"||path.startsWith("/workflows/codex-environments/")},
];
export function WorkflowSubnav(){const pathname=usePathname();return <nav aria-label="Workflow sections"><ul className="flex flex-wrap gap-1 border-b border-slate-300 dark:border-slate-700">{sections.map(item=>{const active=item.matches(pathname);return <li key={item.href}><Link aria-current={active?"page":undefined} className={`block rounded-t-md border-b-2 px-3 py-2 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 ${active?"border-sky-700 bg-sky-50 font-black dark:border-orange-400 dark:bg-slate-800":"border-transparent font-semibold hover:border-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"}`} href={item.href}>{item.label}</Link></li>})}</ul></nav>}
