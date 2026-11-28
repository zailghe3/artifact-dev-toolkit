import { MAX_CONVERSATION_INPUT_BYTES, type ConversationCursor, type ConversationSubmission, type ConversationTarget } from "../adt-runtime/src/conversation-contract.ts";
import type { PostgresWorkflowDatabase } from "../adt-runtime/src/workflow-database.ts";
import { agentDigest } from "./agent-journal.ts";
import { CONVERSATION_CONTEXT_LOOKBACK, CONVERSATION_SUMMARY_BATCH_SIZE, CONVERSATION_CONTEXT_VERSION,
  type ConversationContextMetadata, type HistoryExchange, type StoredConversationContext } from "./conversation-context.ts";
import { isTerminalTurn, type ConversationDetail, type ConversationLaunch, type ConversationList, type ConversationSummary } from "./conversation-types.ts";
import { D1WorkflowApprovalStore } from "./workflow-approvals.ts";
import { D1WorkflowRunStorage } from "./workflow-d1-storage.ts";
import { WorkflowRunContent } from "./workflow-run-content.ts";
import { WorkflowResponseActions } from "./workflow-response-actions.ts";
import { manualRetryEligibility, type RunDetail, type RunRepositoryContext, type RunStatus, type WorkflowRun } from "./workflow-storage.ts";

type ConversationRow = {
  id: string; title: string; target_kind: ConversationTarget["kind"]; target_id: string;
  created_at: string; updated_at: string;
};
type TurnHead = { id: string; ordinal: number; run_id: string; workflow_generation: number; status: RunStatus; context_json: string };
type TurnRow = TurnHead & {
  message: string; created_at: string; target_name: string; definition_digest: string; previous_definition_digest: string | null;
  failure_message: string | null; final_output: string | null; final_external_url: string | null; interactive: boolean;
};
type HistoryRow = Omit<HistoryExchange, "sections"> & { run_id: string };

const LIST_LIMIT = 40;
const TURNS_PER_PAGE = 6;

function view(row: ConversationRow): ConversationSummary {
  return { id: row.id, title: row.title, target: { kind: row.target_kind, id: row.target_id },
    createdAt: row.created_at, updatedAt: row.updated_at };
}

function requestDigest(submission: ConversationSubmission) {
  return agentDigest({ ...submission, exactTurnIds: [...submission.exactTurnIds].sort() });
}

function definitionDigest(run: WorkflowRun) {
  return agentDigest({ workflow: run.workflowRevision, policy: run.executionPolicy ?? null,
    dependencies: run.compositionSnapshot?.dependencies.map(item => [item.workflowId, item.revision]) ?? [],
    agents: run.agentRevisions, prompts: Object.fromEntries(Object.entries(run.agentSnapshots)
      .map(([id, agent]) => [id, agentDigest(agent.masterPrompt)])),
    connections: Object.fromEntries(Object.entries(run.connectionSnapshots)
      .map(([key, connection]) => [key, connection.repositoryRevision ?? null])),
  });
}

export class ConversationStore {
  private readonly scope: string;
  constructor(private readonly db: PostgresWorkflowDatabase, private readonly repository: RunRepositoryContext) {
    this.scope = agentDigest({ ...repository, owner: repository.owner.toLowerCase(), repository: repository.repository.toLowerCase() });
  }

  private get(id: string) {
    return this.db.prepare("SELECT * FROM conversations WHERE id=? AND repository_id=? AND repository_scope=?")
      .bind(id, this.repository.repositoryId, this.scope).first<ConversationRow>();
  }

  private head(id: string) {
    return this.db.prepare(`SELECT t.id,t.ordinal,t.run_id,t.context_json,r.status,r.workflow_generation FROM conversation_turns t
      JOIN workflow_runs r ON r.id=t.run_id WHERE t.conversation_id=? ORDER BY t.ordinal DESC LIMIT 1`)
      .bind(id).first<TurnHead>();
  }

  async prepare(submission: ConversationSubmission) {
    const id = submission.conversationId;
    const conversation = await this.get(id);
    if (!conversation) {
      if (submission.after) throw new Error("conversation_not_found");
      return { head: null };
    }
    const prior = await this.db.prepare("SELECT run_id,request_digest FROM conversation_turns WHERE conversation_id=? AND id=?")
      .bind(id, submission.turnId).first<{ run_id: string; request_digest: string }>();
    if (prior) {
      if (prior.request_digest !== requestDigest(submission)) throw new Error("workflow_idempotency_conflict");
      return { replay: { conversationId: id, turnId: submission.turnId, runId: prior.run_id, replay: true } satisfies ConversationLaunch };
    }
    if (conversation.target_kind !== submission.target.kind || conversation.target_id !== submission.target.id)
      throw new Error("conversation_target_fixed");
    const head = await this.head(id);
    if (head && !isTerminalTurn(head.status)) throw new Error("conversation_turn_active");
    if (!head || head.id !== submission.after?.id || head.workflow_generation !== submission.after.generation)
      throw new Error("conversation_head_changed");
    return { head };
  }

  async append(submission: ConversationSubmission, run: WorkflowRun, ordinal: number, context: ConversationContextMetadata) {
    if (ordinal === 1) {
      const title = (Array.from(submission.message.trim().replace(/\s+/g, " ")).slice(0, 110).join("") || "New conversation");
      await this.db.prepare(`INSERT INTO conversations (id,repository_id,repository_scope,target_kind,target_id,title)
        VALUES (?,?,?,?,?,?)`).bind(submission.conversationId, this.repository.repositoryId, this.scope,
        submission.target.kind, submission.target.id, title).run();
    }
    await this.db.prepare(`INSERT INTO conversation_turns
      (conversation_id,repository_id,id,ordinal,run_id,message,request_digest,definition_digest,target_name,context_json)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(submission.conversationId, this.repository.repositoryId, submission.turnId,
      ordinal, run.id, submission.message, requestDigest(submission), definitionDigest(run),
      run.semanticWorkflowSnapshot!.name, JSON.stringify(context)).run();
    await this.db.prepare("UPDATE conversations SET updated_at=now() WHERE id=?").bind(submission.conversationId).run();
  }

  async history(id: string, head: TurnHead | null, exact: string[]) {
    if (!head) return { history: [], rollingCandidates: [], totalSucceeded: 0 };
    const previous = JSON.parse(head.context_json) as StoredConversationContext;
    const previousSummary = previous.version === CONVERSATION_CONTEXT_VERSION ? previous.summary : undefined;
    const through = head.ordinal;
    const summarisedThrough = previousSummary?.throughOrdinal ?? 0;
    const select = `SELECT t.id,t.ordinal,t.message,t.run_id,
      CASE WHEN r.status='rejected' THEN 'The human rejected the result and ended this Run.'
           WHEN octet_length(r.final_output)>${MAX_CONVERSATION_INPUT_BYTES} THEN left(r.final_output,600)
           ELSE COALESCE(r.final_output,'') END AS response,
      COALESCE(octet_length(r.final_output)<=${MAX_CONVERSATION_INPUT_BYTES},true) AS complete
      FROM conversation_turns t JOIN workflow_runs r ON r.id=t.run_id
      WHERE t.conversation_id=? AND t.ordinal<=? AND r.status IN ('succeeded','rejected')`;
    const [count, history, older] = await Promise.all([
      this.db.prepare(`SELECT count(*) AS total FROM conversation_turns t JOIN workflow_runs r ON r.id=t.run_id
        WHERE t.conversation_id=? AND t.ordinal<=? AND t.ordinal>? AND r.status IN ('succeeded','rejected')`)
        .bind(id, through, summarisedThrough).first<{ total: number }>(),
      this.db.prepare(`SELECT * FROM (${select} ORDER BY t.ordinal DESC LIMIT ?) AS recent
        UNION ${select} AND t.id=ANY(?::uuid[])`)
        .bind(id, through, CONVERSATION_CONTEXT_LOOKBACK, id, through, exact).all<HistoryRow>(),
      this.db.prepare(`${select} AND t.ordinal>? ORDER BY t.ordinal LIMIT ?`)
        .bind(id, through, summarisedThrough, CONVERSATION_SUMMARY_BATCH_SIZE).all<HistoryRow>(),
    ]);
    const runIds = [...new Set([...history.results, ...older.results].map(item => item.run_id))];
    const [sections, interactive] = await Promise.all([
      new WorkflowResponseActions(this.db).historySections(runIds),
      new WorkflowRunContent(this.db).history(runIds),
    ]);
    const asExchange = ({ run_id, complete, ...item }: HistoryRow): HistoryExchange => {
      const responseSections = [...(sections.get(run_id) ?? []), ...(interactive.get(run_id) ?? [])]
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.id.localeCompare(b.id));
      return { ...item, sections: responseSections, complete: complete && responseSections.every(section => section.complete) };
    };
    return { history: history.results.map(asExchange), rollingCandidates: older.results.map(asExchange),
      previousSummary, totalSucceeded: (previousSummary?.coveredTurns ?? 0) + (count?.total ?? 0) };
  }

  async list(query: string, target?: ConversationTarget, before?: ConversationCursor): Promise<ConversationList> {
    const conditions = ["c.repository_id=?", "c.repository_scope=?"];
    const parameters: unknown[] = [this.repository.repositoryId, this.scope];
    if (target) {
      conditions.push("c.target_kind=? AND c.target_id=?");
      parameters.push(target.kind, target.id);
    }
    if (query) {
      conditions.push(`(strpos(lower(c.title),lower(?))>0 OR EXISTS (SELECT 1 FROM conversation_turns t
        WHERE t.conversation_id=c.id AND strpos(lower(t.message),lower(?))>0))`);
      parameters.push(query, query);
    }
    if (before) {
      conditions.push("(c.updated_at,c.id)<(?::timestamptz,?::uuid)");
      parameters.push(before.updatedAt, before.id);
    }
    const { results } = await this.db.prepare(`SELECT c.*, to_char(c.updated_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_date FROM conversations c WHERE ${conditions.join(" AND ")}
      ORDER BY c.updated_at DESC,c.id DESC LIMIT ?`).bind(...parameters, LIST_LIMIT + 1)
      .all<ConversationRow & { cursor_date: string }>();
    const items = results.slice(0, LIST_LIMIT);
    const last = items.at(-1);
    return { items: items.map(view), next: last && results.length > LIST_LIMIT ? { id: last.id, updatedAt: last.cursor_date } : null };
  }

  async rename(id: string, title: string) {
    const row = await this.db.prepare(`UPDATE conversations SET title=?,updated_at=now()
      WHERE id=? AND repository_id=? AND repository_scope=? RETURNING *`)
      .bind(title, id, this.repository.repositoryId, this.scope).first<ConversationRow>();
    if (!row) throw new Error("conversation_not_found");
    return view(row);
  }

  async detail(id: string, before?: number): Promise<ConversationDetail | null> {
    const conversation = await this.get(id);
    if (!conversation) return null;
    const head = await this.head(id);
    if (!head) throw new Error("conversation_not_found");
    const actions = new WorkflowResponseActions(this.db);
    const contentStore = new WorkflowRunContent(this.db);
    const storage = new D1WorkflowRunStorage(this.db, undefined, this.repository.repositoryId);
    const [page, failed, approval] = await Promise.all([
      this.db.prepare(`SELECT t.id,t.message,t.ordinal,t.run_id,t.target_name,t.definition_digest,t.context_json,
        r.status,r.workflow_generation,r.created_at,r.failure_message,r.final_output,r.final_external_url,
        EXISTS (SELECT 1 FROM json_array_elements(r.execution_plan_json->'nodes') node
          WHERE node->>'blockType' IN ('human-decision','human-input','human-edit','display-output')
            OR node->>'blockType'='approval' AND node->>'blockVersion'='2') AS interactive,
        p.definition_digest AS previous_definition_digest FROM conversation_turns t JOIN workflow_runs r ON r.id=t.run_id
        LEFT JOIN conversation_turns p ON p.conversation_id=t.conversation_id AND p.ordinal=t.ordinal-1
        WHERE t.conversation_id=? AND t.ordinal<=? ORDER BY t.ordinal DESC LIMIT ?`)
        .bind(id, Math.min(head.ordinal, before === undefined ? head.ordinal : before - 1), TURNS_PER_PAGE + 1).all<TurnRow>(),
      head.status === "failed" && before === undefined ? storage.getRun(head.run_id) : undefined,
      head.status === "waiting_approval" && before === undefined ? new D1WorkflowApprovalStore(this.db).active(head.run_id) : undefined,
    ]);
    const selected = page.results.slice(0, TURNS_PER_PAGE).reverse();
    const turns = await Promise.all(selected.map(async row => {
      const context = JSON.parse(row.context_json) as StoredConversationContext;
      const summaryUsed = context.version === CONVERSATION_CONTEXT_VERSION ? context.summaryIncluded : Boolean(context.summary);
      const [sections, content] = await Promise.all([
        row.status === "succeeded" ? actions.sections(row.run_id, row.final_output) : [],
        row.interactive ? contentStore.page(row.run_id) : undefined,
      ]);
      const hasDisplayedTerminal = content?.items.some(item => item.kind === "display" && item.section.terminal);
      return { id: row.id, ordinal: row.ordinal, message: row.message, runId: row.run_id, status: row.status,
        generation: row.workflow_generation, createdAt: row.created_at, targetName: row.target_name,
        definitionChanged: Boolean(row.previous_definition_digest && row.previous_definition_digest !== row.definition_digest),
        summaryUsed, summaryLimited: context.version === CONVERSATION_CONTEXT_VERSION && summaryUsed && context.summary?.detailsOmitted,
        omittedHistory: context.omittedHistory,
        failureMessage: row.failure_message ?? undefined, externalUrl: row.final_external_url ?? undefined,
        sections: hasDisplayedTerminal ? sections.filter(section => section.id !== row.run_id + ":output") : sections,
        ...(content ? { content } : {}),
      };
    }));
    return { conversation: view(conversation), turns, earlier: page.results.length > TURNS_PER_PAGE ? selected[0].ordinal : null,
      head: { id: head.id, generation: head.workflow_generation }, retryEligible: manualRetryEligibility(failed).eligible,
      approval: approval?.status === "pending" ? { requestId: approval.requestId, message: approval.message, reviewText: approval.reviewText } : undefined,
      awaitingToolReview: head.status === "waiting_approval" && !approval && !turns.at(-1)?.content?.active,
    };
  }

  async link(runId: string): Promise<RunDetail["conversation"]> {
    const row = await this.db.prepare(`SELECT t.conversation_id,t.id,t.message,
      NOT EXISTS (SELECT 1 FROM conversation_turns next WHERE next.conversation_id=t.conversation_id AND next.ordinal>t.ordinal) AS latest
      FROM conversation_turns t JOIN conversations c ON c.id=t.conversation_id
      WHERE t.run_id=? AND c.repository_id=? AND c.repository_scope=?`)
      .bind(runId, this.repository.repositoryId, this.scope).first<{ conversation_id: string; id: string; message: string; latest: boolean }>();
    return row ? { id: row.conversation_id, turnId: row.id, message: row.message, isLatest: row.latest } : undefined;
  }
}
