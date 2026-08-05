import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { applicationIdentity, primaryNavigationState } from "@/lib/app-navigation";

export function AppHeader({ login, currentPath }: { login: string; currentPath: string }) {
  const navigation = primaryNavigationState(currentPath);
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-slate-50/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 md:flex-nowrap">
          <div className="min-w-0">
            <Link href="/" className="block rounded-md text-base font-black tracking-tight text-slate-950 outline-none transition focus:ring-4 focus:ring-sky-200 dark:text-slate-50 dark:focus:ring-orange-500/35">
              {applicationIdentity.name}
            </Link>
            <p className="hidden text-xs font-medium text-slate-500 sm:block dark:text-slate-400">{applicationIdentity.purpose}</p>
          </div>
          <nav aria-label="Primary" className="order-last -mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 pb-1 md:order-none md:mx-0 md:w-auto md:flex-1 md:px-0 md:pb-0">
            <ul className="flex min-w-max items-center gap-2 md:justify-start">
              {navigation.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={item.active ? "page" : undefined}
                    className={[
                      "inline-flex min-h-10 items-center whitespace-nowrap rounded-full border px-3 py-2 text-sm font-bold outline-none transition focus:ring-4 focus:ring-sky-200 dark:focus:ring-orange-500/35 motion-reduce:transition-none",
                      item.active
                        ? "border-sky-700 bg-sky-50 text-sky-900 shadow-[inset_0_-3px_0_currentColor] dark:border-orange-300 dark:bg-orange-500/10 dark:text-orange-200"
                        : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-950 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:text-slate-50",
                    ].join(" ")}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
            <span className="hidden max-w-32 truncate text-xs font-semibold text-slate-600 sm:inline dark:text-slate-300">@{login}</span>
            <ThemeToggle />
            <SignOutButton login={login} />
          </div>
        </div>
      </div>
    </header>
  );
}
