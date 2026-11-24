import {PageHeader} from "@/components/Ui";
import {AdvisorSettingsForm} from "@/components/AdvisorSettingsForm";
import {requireRepositoryAccess} from "@/lib/auth";
import {getAdvisorSettingsStore} from "@/lib/advisor-services";
import {createWorkflowDefinitionRepository,listWorkflowConnectionIdentityDescriptors} from "@/lib/workflow-services";
export default async function Page(){
  const {access}=await requireRepositoryAccess("/advisor/settings");
  const saved=await (await getAdvisorSettingsStore()).get(access.repositoryId).catch(()=>undefined);
  if(!saved)return <><PageHeader title="Advisor settings"/><p role="alert">Runtime settings are temporarily unavailable.</p></>;
  const [workflows,connections]=await Promise.all([createWorkflowDefinitionRepository(access).listWorkflows(),listWorkflowConnectionIdentityDescriptors(access)]);
  return <><PageHeader title="Advisor settings" description="Choose an ordinary Workflow for on-demand, read-only analysis."/><AdvisorSettingsForm initial={saved} workflows={workflows.map(item=>({id:item.definition.id,name:item.definition.name}))} connections={connections.filter(item=>item.capabilities.agentTools&&item.management==="git").map(item=>({key:item.key,name:item.name,model:item.defaultModel,enabled:item.enabled}))}/><p className="mt-8 text-sm text-slate-500">Scheduling and notifications are not available in v1.</p></>;
}
