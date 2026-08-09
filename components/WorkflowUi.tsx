import Link from "next/link";

export const workflowButton = {
  primary: "inline-flex items-center justify-center rounded-md bg-sky-700 px-4 py-2 font-bold text-white transition hover:bg-sky-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-orange-500 dark:text-slate-950 dark:hover:bg-orange-400",
  secondary: "inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-800 transition hover:border-sky-600 hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-orange-400 dark:hover:bg-slate-800",
  danger: "inline-flex items-center justify-center rounded-md border border-red-600 bg-white px-3 py-2 font-semibold text-red-700 transition hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950",
  subtle: "inline-flex items-center justify-center rounded-md px-2 py-1 font-semibold text-slate-700 underline-offset-4 hover:bg-slate-100 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800",
} as const;

export function WorkflowSectionHeader({title,description,action}:{title:string;description:string;action?:{href:string;label:string}}) {
  return <header className="mb-6 grid gap-2" data-workflow-section-header>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-3xl font-black">{title}</h1>
      {action&&<Link className={workflowButton.primary} href={action.href}>{action.label}</Link>}
    </div>
    <p className="max-w-3xl text-slate-600 dark:text-slate-300">{description}</p>
  </header>;
}

export function EntityCard({href,label,children,actions}:{href:string;label:string;children:React.ReactNode;actions?:React.ReactNode}) {
  return <article className="overflow-hidden rounded-lg border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900" data-entity-card>
    <Link aria-label={label} className="group block cursor-pointer p-4 transition hover:border-sky-600 hover:bg-sky-50 focus-visible:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800" href={href} data-entity-card-link>
      {children}
      <span aria-hidden="true" className="mt-3 block text-right font-bold transition group-hover:translate-x-1">→</span>
    </Link>
    {actions&&<div className="flex flex-wrap items-center gap-2 border-t border-slate-200 p-3 dark:border-slate-700" data-entity-card-actions>{actions}</div>}
  </article>;
}
