import {AppHeader} from "@/components/AppHeader";
import {requireRepositoryAuthorization} from "@/lib/auth";
export default async function AdvisorLayout({children}:{children:React.ReactNode}){
  const session=await requireRepositoryAuthorization("/advisor");
  return <><AppHeader login={session.login} currentPath="/advisor"/><main className="mx-auto max-w-5xl px-4 py-6 sm:px-5">{children}</main></>;
}
