import {
  interactionRequestSchema, interactionResponseSchema, validateInteractionResponse, WORKFLOW_INTERACTION_VERSION,
  type GraphInteraction, type InteractionRequest, type InteractionResponse,
} from "../adt-runtime/src/workflow-interaction-contract.ts";
import type { PostgresWorkflowDatabase } from "../adt-runtime/src/workflow-database.ts";
import { D1WorkflowApprovalStore } from "./workflow-approvals.ts";
import type { RunStatus } from "./workflow-storage.ts";

type Row = {
  request_id: string; run_id: string; workflow_generation: number; node_id: string; activation_id: string;
  interrupt_id: string; interaction_version: number; interaction_sequence: number; request_json: string;
  requested_at: string; response_json: string | null; responder_id: number | null; responder_login: string | null;
  responded_at: string | null; consumed_at: string | null;
};
type Head = { workflow_generation: number; status: RunStatus; cancel_requested_at: string | null };
type Issuance = Pick<GraphInteraction, "nodeId" | "activationId" | "sequence" | "request"> &
  { runId: string; generation: number; interruptId: string };
type Actor = { githubId: number; login: string };
type RequestView = Exclude<InteractionRequest, { kind: "input" }> |
  (Omit<Extract<InteractionRequest, { kind: "input" }>, "sourceContext"> & { sourceContext?: string });

export type WorkflowInteractionView = {
  id: string; nodeId: string; activationId: string; sequence: number; generation: number; request: RequestView;
  requestedAt: string; response?: InteractionResponse; respondedAt?: string; consumedAt?: string;
  responder?: string; actionable: boolean;
};

function decode(row: Row) {
  if (row.interaction_version !== WORKFLOW_INTERACTION_VERSION) throw new Error("interaction_version_unsupported");
  return {
    id: row.request_id, nodeId: row.node_id, activationId: row.activation_id, interruptId: row.interrupt_id,
    sequence: row.interaction_sequence, generation: row.workflow_generation, requestedAt: row.requested_at,
    request: interactionRequestSchema.parse(JSON.parse(row.request_json)),
    response: row.response_json === null ? undefined : interactionResponseSchema.parse(JSON.parse(row.response_json)),
    respondedAt: row.responded_at ?? undefined, consumedAt: row.consumed_at ?? undefined,
    responder: row.responder_login ?? undefined,
  };
}

function view(row: Row, head: Head): WorkflowInteractionView {
  const { id, nodeId, activationId, sequence, generation, requestedAt, request, response, respondedAt, consumedAt, responder } = decode(row);
  return {
    id, nodeId, activationId, sequence, generation, requestedAt, response, respondedAt, consumedAt, responder,
    request: request.kind === "input" && !request.showContext ? { ...request, sourceContext: undefined } : request,
    actionable: head.status === "waiting_approval" && !head.cancel_requested_at &&
      head.workflow_generation === generation && !response,
  };
}

function head(db: PostgresWorkflowDatabase, runId: string) {
  return db.prepare("SELECT workflow_generation,status,cancel_requested_at FROM workflow_runs WHERE id=?").bind(runId).first<Head>();
}

function issued(db: PostgresWorkflowDatabase, runId: string, requestId: string) {
  return db.prepare("SELECT * FROM workflow_approvals WHERE run_id=? AND request_id=? AND interaction_version IS NOT NULL")
    .bind(runId, requestId).first<Row>();
}

/** Versioned requests share the existing Workflow approval suspension and scheduler. */
export class WorkflowInteractions extends D1WorkflowApprovalStore {
  constructor(private readonly database: PostgresWorkflowDatabase) { super(database); }

  async requireInteraction(input: Issuance) {
    return this.database.transaction(async db => {
      const run = await head(db, input.runId);
      if (!run || run.workflow_generation !== input.generation || run.cancel_requested_at ||
          !["queued", "running", "waiting_approval"].includes(run.status)) return undefined;
      const existing = await db.prepare("SELECT * FROM workflow_approvals WHERE run_id=? AND workflow_generation=? AND activation_id=?")
        .bind(input.runId, input.generation, input.activationId).first<Row>();
      if (existing) {
        const saved = decode(existing);
        if (saved.nodeId !== input.nodeId || saved.interruptId !== input.interruptId || saved.sequence !== input.sequence ||
            JSON.stringify(saved.request) !== JSON.stringify(input.request)) throw new Error("interaction_state_conflict");
        return saved;
      }
      const id = crypto.randomUUID();
      const inserted = await db.prepare(`INSERT INTO workflow_approvals
        (request_id,run_id,workflow_generation,node_id,activation_id,interrupt_id,message,review_text,status,requested_at,
         interaction_version,interaction_sequence,request_json)
        VALUES (?,?,?,?,?,?,?,'','pending',clock_timestamp(),?,?,?) RETURNING *`)
        .bind(id, input.runId, input.generation, input.nodeId, input.activationId, input.interruptId, input.request.question,
          input.request.version, input.sequence, JSON.stringify(input.request)).first<Row>();
      await db.prepare(`UPDATE workflow_runs SET status='waiting_approval',current_step_id=?,updated_at=clock_timestamp(),
        started_at=COALESCE(started_at,clock_timestamp()),state_version=state_version+1 WHERE id=?`).bind(input.nodeId, input.runId).run();
      return decode(inserted!);
    });
  }

  async respond(runId: string, requestId: string, actor: Actor, response: InteractionResponse) {
    const validatedResponse = interactionResponseSchema.parse(response);
    return this.database.transaction(async db => {
      const [run, row] = await Promise.all([head(db, runId), issued(db, runId, requestId)]);
      if (!run || !row) throw new Error("interaction_not_found");
      if (run.workflow_generation !== row.workflow_generation || run.cancel_requested_at ||
          ["cancelling", "cancelled", "failed"].includes(run.status)) throw new Error("interaction_not_pending");
      const saved = decode(row);
      if (saved.response) {
        if (row.responder_id !== actor.githubId || JSON.stringify(saved.response) !== JSON.stringify(validatedResponse))
          throw new Error("interaction_response_conflict");
        return view(row, run);
      }
      if (run.status !== "waiting_approval") throw new Error("interaction_not_pending");
      validateInteractionResponse(saved.request, validatedResponse);
      const updated = await db.prepare(`UPDATE workflow_approvals SET status='responded',response_json=?,responder_id=?,
        responder_login=?,responded_at=clock_timestamp() WHERE request_id=? RETURNING *`)
        .bind(JSON.stringify(validatedResponse), actor.githubId, actor.login, requestId).first<Row>();
      return view(updated!, run);
    });
  }

  async consumeInteraction(runId: string, generation: number, requestId: string) {
    return this.database.transaction(async db => {
      const [run, row] = await Promise.all([head(db, runId), issued(db, runId, requestId)]);
      if (!run || !row || run.workflow_generation !== generation || row.workflow_generation !== generation ||
          run.cancel_requested_at || row.response_json === null) return false;
      if (row.consumed_at) return run.status === "running";
      if (run.status !== "waiting_approval") return false;
      await db.prepare("UPDATE workflow_approvals SET consumed_at=clock_timestamp() WHERE request_id=?").bind(requestId).run();
      await db.prepare(`UPDATE workflow_runs SET status='running',updated_at=clock_timestamp(),state_version=state_version+1
        WHERE id=?`).bind(runId).run();
      return true;
    });
  }

  async read(runId: string, requestId: string) {
    const [run, row] = await Promise.all([head(this.database, runId), issued(this.database, runId, requestId)]);
    if (!run || !row) throw new Error("interaction_not_found");
    return view(row, run);
  }
}
