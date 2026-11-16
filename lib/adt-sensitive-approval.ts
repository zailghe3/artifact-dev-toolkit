import {hasToolRole} from "./agent-tool-roles.ts";
import type {AgentJournal,ToolInvocation} from "./agent-journal.ts";
/** Defense in depth at consumption: a read-only label or model claim is never consent. */
export async function requireSensitiveReadApproval(journal:AgentJournal,call:ToolInvocation,admissionId:string){
 const current=await journal.call(call.id),approval=current&&await journal.approval(current);
 if(!current||current.state!=="admitted"||current.admission_id!==admissionId||current.fingerprint!==call.fingerprint||current.arguments_json!==call.arguments_json||current.execution_deadline_at===null||current.execution_deadline_at<=journal.now()||!approval||approval.status!=="approved"||approval.expires_at<=journal.now()||!hasToolRole(approval.decided_by??"","approver",journal.environment))throw Error("permission_denied");
}
