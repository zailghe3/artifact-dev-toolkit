import { AppHeader } from "@/components/AppHeader";
import { WorkflowSubnav } from "@/components/WorkflowSubnav";
import { requireRepositoryAuthorization } from "@/lib/auth";

export default async function ToolsLayout({children}:{children:React.ReactNode}) {
  const session=await requireRepositoryAuthorization("/tools");
  return <><AppHeader login={session.login} currentPath="/tools" secondaryNavigation={<WorkflowSubnav/>}/><main className="mx-auto max-w-5xl px-4 py-6">{children}</main></>;
}
