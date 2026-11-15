import { AppHeader } from "@/components/AppHeader";
import { WorkflowSubnav } from "@/components/WorkflowSubnav";
import { requireRepositoryAuthorization } from "@/lib/auth";
export default async function WorkflowLayout({children}:{children:React.ReactNode}) { const session=await requireRepositoryAuthorization("/workflows"); return <><AppHeader login={session.login} currentPath="/workflows" secondaryNavigation={<WorkflowSubnav/>}/><main className="mx-auto max-w-5xl px-4 py-6">{children}</main></>; }
