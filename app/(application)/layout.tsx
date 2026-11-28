import { cookies } from "next/headers";
import { sidebarPreference } from "@/lib/app-navigation";
import { ApplicationShell } from "@/components/ApplicationShell";
import { getRenderSession, hasStoredDiagnosticsAccess } from "@/lib/auth";
import { DeploymentFooter } from "@/components/DeploymentFooter";
import { getDeploymentMetadata } from "@/lib/deployment-metadata.server";

export default async function ApplicationLayout({ children }: { children: React.ReactNode }) {
  const [session, cookieStore] = await Promise.all([getRenderSession(), cookies()]);
  // The route owns redirects and authorization, including its exact return URL.
  if (!session || !hasStoredDiagnosticsAccess(session)) return children;
  const preference = cookieStore.get(sidebarPreference)?.value;
  const initialExpanded = preference === "expanded" ? true : preference === "collapsed" ? false : undefined;
  return <>
    <ApplicationShell login={session.login} initialExpanded={initialExpanded}>{children}</ApplicationShell>
    <DeploymentFooter metadata={getDeploymentMetadata()} />
  </>;
}
