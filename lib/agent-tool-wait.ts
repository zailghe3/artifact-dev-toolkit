import {AgentJournal} from "./agent-journal.ts";
import type {WorkflowD1Database} from "./workflow-d1-storage.ts";
import type {WorkflowRunStorage} from "./workflow-storage.ts";
export const agentWakeType=(runId:string)=>`agent-${runId}`;
type WaitContext={runId:string;db:WorkflowD1Database;storage:WorkflowRunStorage};
export async function checkAgentToolWait(input:WaitContext) {
 const journal=new AgentJournal(input.db);
  const run=await input.storage.getRun(input.runId);if(!run||run.run.cancelRequestedAt||["cancelling","cancelled","failed","succeeded"].includes(run.run.status)){await journal.cancelPending(input.runId);return}
  if(run.run.failureCode)await input.db.batch([
   input.db.prepare("UPDATE agent_tool_approvals SET status='cancelled',decided_at=? WHERE status='pending' AND invocation_id IN (SELECT i.id FROM agent_tool_invocations i JOIN agent_continuations c ON c.id=i.continuation_id WHERE c.run_id=?)").bind(Date.now(),input.runId),
   input.db.prepare("UPDATE agent_tool_invocations SET state='cancelled' WHERE state IN ('proposed','validated','waiting','eligible') AND continuation_id IN (SELECT id FROM agent_continuations WHERE run_id=?)").bind(input.runId)
  ]);
  const waiting=await input.db.prepare("SELECT c.id,MIN(a.expires_at) AS expires_at FROM agent_continuations c JOIN agent_tool_invocations i ON i.continuation_id=c.id LEFT JOIN agent_tool_approvals a ON a.invocation_id=i.id WHERE c.run_id=? AND c.generation=? AND ((c.state='waiting' AND i.state='waiting' AND a.status='pending' AND a.expires_at>?) OR (c.state='reconciliation' AND i.state='unknown')) GROUP BY c.id ORDER BY c.id LIMIT 1").bind(input.runId,run.run.workflowGeneration,Date.now()).first<{id:string;expires_at:number|null}>();
  if(!waiting){await input.db.prepare("UPDATE workflow_runs SET status='running',updated_at=? WHERE id=? AND status='waiting_approval' AND cancel_requested_at IS NULL AND NOT EXISTS(SELECT 1 FROM workflow_approvals WHERE run_id=? AND consumed_at IS NULL)").bind(new Date().toISOString(),input.runId,input.runId).run();return}
  // A waiting Agent must not prevent an independent admitted branch from progressing.
  const runnable=await input.db.prepare("SELECT 1 AS present FROM workflow_step_attempts s LEFT JOIN agent_continuations c ON c.run_id=s.run_id AND c.node_id=s.step_id AND c.iteration=s.iteration AND c.attempt=s.attempt AND c.generation=? WHERE s.run_id=? AND s.status IN ('pending','starting','waiting_provider') AND NOT (COALESCE(c.state,'')='waiting' AND EXISTS(SELECT 1 FROM agent_tool_invocations i JOIN agent_tool_approvals a ON a.invocation_id=i.id WHERE i.continuation_id=c.id AND i.state='waiting' AND a.status='pending' AND a.expires_at>?) OR COALESCE(c.state,'')='reconciliation' AND EXISTS(SELECT 1 FROM agent_tool_invocations i WHERE i.continuation_id=c.id AND i.state='unknown')) LIMIT 1").bind(run.run.workflowGeneration,input.runId,Date.now()).first<{present:number}>();
  if(runnable)return;
  await input.db.prepare("UPDATE workflow_runs SET status='waiting_approval',updated_at=? WHERE id=? AND status IN ('queued','running') AND cancel_requested_at IS NULL").bind(new Date().toISOString(),input.runId).run();
  const seconds=Math.max(1,Math.min(3600,Math.ceil(((waiting.expires_at??Date.now()+3600000)-Date.now())/1000)));
  return {id:waiting.id,seconds};
}

/** Wake events carry no authority. Each wake rechecks persisted state. */
export async function waitForAgentTools(input:WaitContext&{wait:(name:string,type:string,seconds:number)=>Promise<unknown>}){
 for(let occurrence=0;;occurrence++){
  const waiting=await checkAgentToolWait(input);
  if(!waiting)return;
  try{await input.wait(`agent-tool-wait-${waiting.id}-${occurrence}`,agentWakeType(input.runId),waiting.seconds)}catch{/* Recheck durable state. */}
 }
}
