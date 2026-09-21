import {workflowRunName} from "@/lib/workflow-run-presentation";import {EmptyState,PageHeader} from "@/components/Ui";
import {WorkflowRunsTable} from "@/components/WorkflowRunsTable";
import {getWorkflowRunStorage} from "@/lib/workflow-services";
export default async function Page(){const runs=await (await getWorkflowRunStorage()).listRuns(50);return <><PageHeader title="Workflow runs" description="Review current and completed Workflow executions."/>{runs.length?<WorkflowRunsTable runs={runs.map(run=>({id:run.id,workflowName:workflowRunName(run),status:run.status,createdAt:run.createdAt,startedAt:run.startedAt,completedAt:run.completedAt,currentStepId:run.currentStepId}))}/>:<EmptyState title="No workflow runs yet">Runs appear here after a Workflow is started.</EmptyState>}</>}
