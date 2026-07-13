export function SignOutButton({ login }: { login: string }) {
  return (
    <form action="/sign-out" method="post" className="flex items-center gap-3">
      <span className="hidden text-sm text-slate-500 dark:text-slate-400 sm:inline">Signed in as <strong>{login}</strong></span>
      <button type="submit" className="rounded-lg text-sm font-semibold text-slate-600 transition hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-sky-200 dark:text-slate-300 dark:hover:text-white dark:focus:ring-orange-500/35">Sign out</button>
    </form>
  );
}
