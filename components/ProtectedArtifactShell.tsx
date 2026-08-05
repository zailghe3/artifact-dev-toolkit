import { AppHeader } from "@/components/AppHeader";

export function ProtectedArtifactShell({ login, currentPath, children }: { login: string; currentPath: string; children: React.ReactNode }) {
  return <><AppHeader login={login} currentPath={currentPath} /><main className="mx-auto min-h-screen max-w-4xl px-4 py-6 sm:px-6 lg:px-8">{children}</main></>;
}
