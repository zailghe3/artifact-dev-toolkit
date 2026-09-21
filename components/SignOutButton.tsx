import {buttonStyles} from "@/components/Ui";
export function SignOutButton({ login }: { login: string }) {
  return (
    <form action="/sign-out" method="post" className="flex items-center gap-3">
      <span className="hidden text-sm text-slate-500 dark:text-slate-400 sm:inline">Signed in as <strong>{login}</strong></span>
      <button type="submit" className={buttonStyles.subtle}>Sign out</button>
    </form>
  );
}
