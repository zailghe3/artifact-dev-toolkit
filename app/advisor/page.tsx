import Link from "next/link";
import {PageHeader,buttonStyles} from "@/components/Ui";
import {AdvisorQuestion} from "@/components/AdvisorQuestion";
import {requireRepositoryAccess} from "@/lib/auth";
import {getAdvisorSettingsStore} from "@/lib/advisor-services";
import {validateAdvisorSelection} from "@/lib/advisor-configuration";
import {validateAdvisorDependencies} from "@/lib/advisor-dependencies";
import {createWorkflowDefinitionRepository,listWorkflowConnectionIdentityDescriptors} from "@/lib/workflow-services";
import {workflowError} from "@/lib/workflow-http";
export default async function Page(){
  const {access}=await requireRepositoryAccess("/advisor"),{settings}=await (await getAdvisorSettingsStore()).get(access.repositoryId);
  let selected:Awaited<ReturnType<typeof validateAdvisorSelection>>,error="";
  try{selected=await validateAdvisorSelection(settings,createWorkflowDefinitionRepository(access),await listWorkflowConnectionIdentityDescriptors(access),agents=>validateAdvisorDependencies(access,agents))}catch(reason){error=((await workflowError(reason).json()) as {error:string}).error}
  return <><PageHeader title="Advisor" description="Investigate Workflow configuration and execution evidence. Each question starts a fresh execution." action={<Link href="/advisor/settings" className={buttonStyles.secondary}>Advisor settings</Link>}/>{error?<p role="alert" className="mt-4">{error}</p>:null}{selected?<div className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"><p>Workflow: <Link className="font-bold underline" href={`/workflows/definitions/${selected.workflow.id}`}>{selected.workflow.name}</Link> · <Link className="underline" href={`/workflows/definitions/${selected.workflow.id}/edit`}>Edit Workflow</Link></p><ul className="mt-2 text-sm">{selected.agents.map(agent=><li key={agent.id}>{agent.name}: {agent.connectionKey} · {agent.provider} · {agent.model}</li>)}</ul></div>:!error?<p className="mt-4">Advisor is not configured. <Link className="underline" href="/advisor/settings">Select a Workflow in Advisor settings</Link>. See <a className="underline" href="https://github.com/zailghe3/artifact-dev-toolkit/blob/main/docs/advisor-setup.md">default Workflow setup</a>.</p>:null}<AdvisorQuestion configured={Boolean(selected)&&!error}/></>;
}
