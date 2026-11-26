"use client";

import Link from "next/link";
import { Tooltip } from "@/components/ui/tooltip";

export function SidebarLink({ href, label, active, current = active, rail, icon: Icon, onNavigate }: {
  href: string;
  label: string;
  active: boolean;
  current?: boolean;
  rail?: boolean;
  icon: React.ComponentType<{ "aria-hidden": true }>;
  onNavigate?: () => void;
}) {
  const link = (
    <Link href={href} onNavigate={onNavigate} aria-current={current ? "page" : undefined} aria-label={rail ? label : undefined}
      data-active={active} className={`adt-nav-action ${rail ? "justify-center px-0" : "px-2.5"}`}>
      <Icon aria-hidden={true} />
      {!rail && <span className="truncate">{label}</span>}
    </Link>
  );
  return rail ? <Tooltip label={label}>{link}</Tooltip> : link;
}
