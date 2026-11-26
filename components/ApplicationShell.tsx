"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import {
  Activity, Blocks, BookOpen, Bot, ChevronDown, ChevronRight, CirclePlay, GitBranch, Layers3,
  LogOut, Menu as MenuIcon, MessagesSquare, Moon, PanelLeftClose, PanelLeftOpen, Plug, Settings2, ShieldCheck, Sun,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import { applicationIdentity, primaryNavigationState, sidebarPreference } from "@/lib/app-navigation";
import { workflowSectionState } from "@/lib/workflow-navigation";
import { SidebarLink } from "@/components/ui/sidebar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { useThemePreference } from "@/components/ThemeToggle";

const primaryIcons = { "/": Layers3, "/workflows": Workflow, "/advisor": MessagesSquare, "/diagnostics": Activity };
const sectionIcons = new Map([
  ["/workflows/definitions", GitBranch],
  ["/workflows/runs", CirclePlay],
  ["/workflows/agents", Bot],
  ["/workflows/connections", Plug],
  ["/tools", Blocks],
  ["/security", ShieldCheck],
  ["/advisor/knowledge", BookOpen],
  ["/advisor/settings", Settings2],
]);

const advisorSections = [
  { label: "Knowledge", href: "/advisor/knowledge" },
  { label: "Settings", href: "/advisor/settings" },
];

function navigationSections(pathname: string) {
  const workflows = workflowSectionState(pathname).map(item =>
    item.href === "/workflows/definitions" ? { ...item, label: "Definitions" } : item);
  const advisor = advisorSections.map(item => ({ ...item, active: pathname === item.href || pathname.startsWith(`${item.href}/`) }));
  return { workflows, advisor };
}

const desktopQuery = "(min-width: 48rem)";
function subscribeToDesktop(change: () => void) {
  const query = window.matchMedia(desktopQuery);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
}

function SidebarAccount({ login, rail }: { login: string; rail: boolean }) {
  const { nextTheme, toggleTheme } = useThemePreference();
  const signOutForm = useRef<HTMLFormElement>(null);
  const ThemeIcon = nextTheme === "light" ? Sun : Moon;
  const trigger = (
    <Menu.Trigger className={`adt-nav-action ${rail ? "justify-center px-0" : "px-1.5"}`} aria-label={`Account for ${login}`}>
      <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-background text-xs font-semibold uppercase">{login.slice(0, 2)}</span>
      {!rail && <><span className="min-w-0 flex-1 truncate text-left">{login}</span><ChevronDown aria-hidden="true" /></>}
    </Menu.Trigger>
  );
  return (
    <Menu.Root>
      {rail ? <Tooltip label={`Account for ${login}`}>{trigger}</Tooltip> : trigger}
      <Menu.Portal>
        <Menu.Content side={rail ? "right" : "top"} align="start" sideOffset={8} className="z-[70] min-w-48 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md">
          <Menu.Label className="truncate px-2 py-1.5 text-xs text-muted-foreground">Signed in as {login}</Menu.Label>
          <Menu.Separator className="my-1 h-px bg-border" />
          <Menu.Item className="adt-menu-item" onSelect={toggleTheme}><ThemeIcon aria-hidden="true" /> Switch to {nextTheme} mode</Menu.Item>
          <form ref={signOutForm} action="/sign-out" method="post" />
          <Menu.Item className="adt-menu-item" onSelect={() => signOutForm.current?.requestSubmit()}>
            <LogOut aria-hidden="true" /> Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function SidebarNavigation({ pathname, login, rail = false, onNavigate }: {
  pathname: string;
  login: string;
  rail?: boolean;
  onNavigate?: () => void;
}) {
  const [groups, setGroups] = useState({ workflows: true, advisor: true });
  const groupId = useId();
  const primary = primaryNavigationState(pathname);
  const sections = navigationSections(pathname);
  return (
    <>
      <div className={`adt-sidebar-brand ${rail ? "justify-center px-0" : "px-3"}`}>
        <Link href="/" onNavigate={onNavigate} aria-label={applicationIdentity.name}
          className="flex min-w-0 items-center gap-2.5 rounded-md font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><Layers3 className="size-4" aria-hidden="true" /></span>
          {!rail && <span className="truncate">{applicationIdentity.name}</span>}
        </Link>
      </div>
      <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-3">
        <ul className="space-y-1">
          {primary.map(item => {
            const group = item.href === "/workflows" ? "workflows" : item.href === "/advisor" ? "advisor" : undefined;
            const open = group ? groups[group] : false;
            const groupSections = group ? sections[group].filter(item => sectionIcons.has(item.href)) : [];
            const id = `${groupId}-${group}`;
            return (
              <li key={item.href}>
                <div className="flex items-center gap-0.5 [&>*:first-child]:min-w-0 [&>*:first-child]:flex-1">
                  <SidebarLink {...item} current={item.active && (!group || pathname === item.href)} icon={primaryIcons[item.href]} rail={rail} onNavigate={onNavigate} />
                  {group && !rail && <button type="button" aria-label={`${open ? "Collapse" : "Expand"} ${item.label} sections`}
                    aria-expanded={open} aria-controls={id} onClick={() => setGroups(current => ({ ...current, [group]: !open }))}
                    className="adt-nav-action w-9 shrink-0 justify-center">
                    {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                  </button>}
                </div>
                {group && (
                  <ul id={id} hidden={!rail && !open} aria-label={`${item.label} sections`}
                    className={rail ? "mt-1 space-y-1" : "my-1 ml-4 space-y-0.5 border-l border-border pl-2"}>
                    {groupSections.map(section => (
                      <li key={section.href}><SidebarLink {...section} icon={sectionIcons.get(section.href)!} rail={rail} onNavigate={onNavigate} /></li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="adt-sidebar-account border-t border-border px-2.5 py-2.5">
        <SidebarAccount login={login} rail={rail} />
      </div>
    </>
  );
}

export function ApplicationShell({ login, initialExpanded, children }: {
  login: string;
  initialExpanded: boolean | undefined;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const desktop = useSyncExternalStore(subscribeToDesktop, () => window.matchMedia(desktopQuery).matches, () => true);
  const [expanded, setExpanded] = useState(initialExpanded ?? true);
  const [mobilePath, setMobilePath] = useState<string>();
  const rail = !expanded;
  const primary = primaryNavigationState(pathname).find(item => item.active);
  const { workflows, advisor } = navigationSections(pathname);
  const section = [...workflows, ...advisor].find(item => item.active);
  const toggle = () => {
    const next = rail;
    setExpanded(next);
    document.cookie = `${sidebarPreference}=${next ? "expanded" : "collapsed"}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  };
  const DesktopIcon = rail ? PanelLeftOpen : PanelLeftClose;

  return (
    <TooltipProvider delayDuration={250}>
      <div className={`adt-shell ${rail ? "adt-shell-rail" : "adt-shell-expanded"}`}>
        <a href="#main-content" className="adt-button adt-button-primary sr-only z-[80] focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
        <aside id="desktop-sidebar" className="adt-desktop-sidebar sticky top-0 hidden h-dvh min-w-0 flex-col self-start border-r border-border bg-sidebar text-sidebar-foreground md:flex">
          <SidebarNavigation pathname={pathname} login={login} rail={rail} />
        </aside>
        <div className="min-w-0">
          <header className="adt-topbar sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background">
            <Tooltip label={rail ? "Expand sidebar" : "Collapse sidebar"}>
              <button type="button" className="adt-nav-action hidden size-9 justify-center md:inline-flex" onClick={toggle}
                aria-label={rail ? "Expand sidebar" : "Collapse sidebar"} aria-controls="desktop-sidebar" aria-expanded={!rail}><DesktopIcon aria-hidden="true" /></button>
            </Tooltip>
            <Sheet open={!desktop && mobilePath === pathname} onOpenChange={open => setMobilePath(open ? pathname : undefined)}>
              <SheetTrigger className="adt-nav-action size-11 justify-center md:hidden" aria-label="Open navigation"><MenuIcon aria-hidden="true" /></SheetTrigger>
              <SheetContent title="Application navigation">
                <SidebarNavigation pathname={pathname} login={login} onNavigate={() => setMobilePath(undefined)} />
              </SheetContent>
            </Sheet>
            <div className="flex min-w-0 items-center gap-2 border-l border-border pl-3 text-sm">
              {primary && section && section.label !== primary.label ? (
                <><Link href={primary.href} className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-ring">{primary.label}</Link><ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="truncate font-medium">{section.label}</span></>
              ) : <span className="truncate font-medium">{primary?.label ?? applicationIdentity.name}</span>}
            </div>
          </header>
          <main id="main-content" tabIndex={-1} className="adt-page min-w-0">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}
