import { AppHeader } from "@/components/AppHeader";
import { requireRepositoryAuthorization } from "@/lib/auth";

export default async function SecurityLayout({children}:{children:React.ReactNode}) {
  const session=await requireRepositoryAuthorization("/security");
  return <><AppHeader login={session.login} currentPath="/security"/><main className="mx-auto max-w-5xl px-4 py-6">{children}</main></>;
}
