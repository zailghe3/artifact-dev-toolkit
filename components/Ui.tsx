import Link from "next/link";

export const buttonStyles = {
  primary: "adt-button adt-button-primary",
  secondary: "adt-button adt-button-secondary",
  danger: "adt-button adt-button-danger",
  subtle: "adt-button adt-button-subtle",
} as const;

export function PageHeader({title,description,meta,action}:{title:string;description?:React.ReactNode;meta?:React.ReactNode;action?:{href:string;label:string}|React.ReactNode}) {
  const control=action&&(typeof action==="object"&&action!==null&&"href" in action?<Link className={buttonStyles.primary} href={action.href}>{action.label}</Link>:action);
  return <header className="mb-5 grid gap-2" data-page-header>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h1 className="text-3xl font-black tracking-tight">{title}</h1>{meta&&<div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{meta}</div>}</div>
      {control&&<div className="shrink-0">{control}</div>}
    </div>
    {description&&<div className="max-w-3xl text-slate-600 dark:text-slate-300">{description}</div>}
  </header>;
}

export function EntityCard({href,label,children,actions}:{href:string;label:string;children:React.ReactNode;actions?:React.ReactNode}) {
  return <article className="adt-entity-card" data-entity-card>
    <Link aria-label={label} className="adt-entity-card-body group" href={href} data-entity-card-link>
      <div className="min-w-0 flex-1">{children}</div>
      <span aria-hidden="true" className="adt-entity-card-open">→</span>
    </Link>
    {actions&&<div className="adt-entity-actions" data-entity-card-actions>{actions}</div>}
  </article>;
}

export function EntityActions({danger,children}:{danger?:React.ReactNode;children?:React.ReactNode}) {
  return <div className="flex w-full flex-wrap items-center gap-2">{danger&&<div>{danger}</div>}<div className="ml-auto flex flex-wrap items-center justify-end gap-2">{children}</div></div>;
}

export function FormActions({danger,children,feedback,label="Form actions"}:{danger?:React.ReactNode;children:React.ReactNode;feedback?:React.ReactNode;label?:string}) {
  return <div aria-label={label} className="grid gap-2 border-t border-slate-200 pt-4 dark:border-slate-700"><div className="flex flex-wrap items-center gap-2">{danger&&<div>{danger}</div>}<div className="ml-auto flex flex-wrap items-center justify-end gap-2">{children}</div></div>{feedback}</div>;
}

export function EmptyState({title,children,action}:{title?:string;children:React.ReactNode;action?:React.ReactNode}) {
  return <div className="adt-empty-state">{title&&<h2 className="font-bold">{title}</h2>}<div className={title?"mt-1 text-slate-600 dark:text-slate-300":"text-slate-600 dark:text-slate-300"}>{children}</div>{action&&<div className="mt-3">{action}</div>}</div>;
}

export function Panel({children,className="",...props}:React.ComponentPropsWithoutRef<"section">) {
  return <section className={`adt-panel ${className}`} {...props}>{children}</section>;
}
