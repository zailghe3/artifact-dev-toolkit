import {EmptyState,PageHeader} from "@/components/Ui";
import {WorkflowRunsTable,type WorkflowRunTableRow} from "@/components/WorkflowRunsTable";
import {workflowRunName} from "@/lib/workflow-run-presentation";
import {getWorkflowRunStorage} from "@/lib/workflow-services";
import type {WorkflowRun} from "@/lib/workflow-storage";

const row=(run:WorkflowRun):WorkflowRunTableRow=>({id:run.id,workflowName:workflowRunName(run),status:run.status,createdAt:run.createdAt,startedAt:run.startedAt,completedAt:run.completedAt,currentStepId:run.currentStepId});
export default async function WorkflowsPage(){const runs=await (await getWorkflowRunStorage()).listRuns(10),active=runs.filter(run=>!["succeeded","failed","cancelled"].includes(run.status));return <><PageHeader title="Workflows" description="Run durable, deterministic sequences of configured agents." action={{href:"/workflows/definitions",label:"Start workflow"}}/><section className="mt-8"><h2 className="mb-3 text-xl font-bold">Active runs</h2>{active.length?<WorkflowRunsTable runs={active.map(row)}/>:<EmptyState>There are no active runs.</EmptyState>}</section><section className="mt-8"><h2 className="mb-3 text-xl font-bold">Recent runs</h2>{runs.length?<WorkflowRunsTable runs={runs.map(row)}/>:<EmptyState>There are no workflow runs yet.</EmptyState>}</section></>}
