import type {StepAttempt,WorkflowRun} from "../lib/workflow-storage";
import type {AgentOperationDiagnostics} from "../lib/workflow-agent-diagnostics";
import {workflowOrchestrationTransportLabel,workflowOrchestrationTransportReasonLabel} from "../lib/workflow-run-presentation";
import {codexRunnerStatusHref} from "../lib/codex-runner-correlation";
import {getProviderConnectionType} from "../lib/provider-connection-types";

const operationLabels:Record<AgentOperationDiagnostics["operation"],string>={
  model_progression:"Model progression",tool_execution:"Tool execution",security_decision:"Security decision",
};
const stageLabels:Record<AgentOperationDiagnostics["stage"],string>={
  preparation:"Request preparation",readiness:"Runtime readiness",dispatch:"Request dispatch",response:"Runtime response",
};

export function WorkflowAttemptTroubleshooting({run,attempt}:{run:Pick<WorkflowRun,"connectionSnapshots">;attempt:StepAttempt}){
  const uncertain=attempt.failureCategory==="provider_start_ambiguous";
  if(!uncertain&&!attempt.agentOperationDiagnostics)return null;
  const adapter=run.connectionSnapshots[attempt.connectionKey]?.adapter;
  if(uncertain&&adapter==="codex-runner")return <p className="mt-2">
    <a className="font-semibold underline" href={codexRunnerStatusHref(attempt)}>Check Codex Runner status</a>. External work may exist. Check its status before manually retrying.
  </p>;
  if(adapter&&getProviderConnectionType(adapter)?.execution==="adt-runtime")return <p className="mt-2">
    <a className="font-semibold underline" href="/diagnostics#adt-runtime">Check ADT Runtime diagnostics</a>. {uncertain?
      "Correlate the client request ID, when available, with Runtime logs and check provider activity before manually retrying.":
      "Use the client request ID to correlate the failure with Runtime logs."}
  </p>;
  return uncertain?<p className="mt-2">Check the configured provider for existing work before manually retrying.</p>:null;
}

export function WorkflowProviderDiagnostics({attempt}:{attempt:StepAttempt}){
  const agent=attempt.agentOperationDiagnostics,provider=attempt.providerTransportDiagnostics;
  const diagnostic=agent??provider;
  if(!diagnostic)return null;
  return <details className="mt-3 rounded border p-3">
    <summary className="cursor-pointer font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700">Provider diagnostics</summary>
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      {agent&&<><dt>Operation</dt><dd>{operationLabels[agent.operation]}</dd><dt>Stage</dt><dd>{stageLabels[agent.stage]}</dd></>}
      <dt>Client request ID</dt><dd><code>{diagnostic.clientRequestId}</code></dd>
      <dt>Transport outcome</dt><dd>{diagnostic.outcome==="not_dispatched"?"Request not dispatched":workflowOrchestrationTransportLabel(diagnostic.outcome)}</dd>
      {diagnostic.reason&&<><dt>Transport reason</dt><dd>{workflowOrchestrationTransportReasonLabel(diagnostic.reason)}</dd></>}
      {diagnostic.runtimeErrorName&&<><dt>Runtime exception</dt><dd><code>{diagnostic.runtimeErrorName}</code></dd></>}
      <dt>Request duration</dt><dd>{diagnostic.elapsedMs>=1000?`${(diagnostic.elapsedMs/1000).toFixed(1)} s`:`${diagnostic.elapsedMs} ms`}</dd>
      {diagnostic.httpStatus!==undefined&&<><dt>HTTP status</dt><dd>{diagnostic.httpStatus}</dd></>}
      {agent?.runtimeCode&&<><dt>Runtime error code</dt><dd><code>{agent.runtimeCode}</code></dd></>}
      {agent?.operation==="model_progression"&&<><dt>Provider execution entry</dt><dd>{agent.providerExecutionEntered===undefined?"Unconfirmed":agent.providerExecutionEntered?"Confirmed by Runtime":"Runtime reported no entry"}</dd></>}
      {provider&&<><dt>Provider request ID</dt><dd>{provider.requestId?<code>{provider.requestId}</code>:"Not received"}</dd></>}
      {provider?.processingMs!==undefined&&<><dt>Provider processing</dt><dd>{provider.processingMs} ms</dd></>}
    </dl>
  </details>;
}
