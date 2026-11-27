import type { GraphKnowledgeOutput } from "../adt-runtime/src/langgraph.ts";
import { MAX_CONVERSATION_INPUT_BYTES } from "../adt-runtime/src/conversation-contract.ts";
import type { PostgresWorkflowDatabase } from "../adt-runtime/src/workflow-database.ts";
import { agentDigest } from "./agent-journal.ts";
import { MAX_KNOWLEDGE_BYTES, type KnowledgeDocument } from "./advisor-knowledge.ts";
import { utf8Prefix, type HistorySection } from "./conversation-context.ts";
import type { ResponseSection } from "./conversation-types.ts";
import type { RunDetail, WorkflowRun } from "./workflow-storage.ts";

type ActionRow = {
  id: string; node_id: string; activation_id: string; source_node_id: string; source_activation_id: string;
  sequence: number; label: string; content: string; response_section: "section" | "terminal" | null;
};

const actionId = (runId: string, nodeId: string, activationId: string) => agentDigest([runId, nodeId, activationId]);

export class WorkflowResponseActions {
  constructor(private readonly database: PostgresWorkflowDatabase) {}

  async record(run: WorkflowRun, output: GraphKnowledgeOutput) {
    const id = actionId(run.id, output.nodeId, output.activationId);
    await this.database.transaction(async db => {
      const result = await db.prepare(`INSERT INTO workflow_run_actions
        (id, run_id, node_id, activation_id, source_node_id, source_activation_id, sequence, kind, label, content)
        VALUES (?,?,?,?,?,?,?,'knowledge-proposal',?,?) ON CONFLICT DO NOTHING`)
        .bind(id, run.id, output.nodeId, output.activationId, output.sourceNodeId, output.sourceActivationId,
          output.sequence, output.label, output.content).run();
      if (result.meta.changes) return;
      const existing = await this.get(run.id, id, db);
      if (!existing || existing.content !== output.content || existing.label !== output.label ||
          existing.source_node_id !== output.sourceNodeId || existing.source_activation_id !== output.sourceActivationId ||
          existing.sequence !== output.sequence) throw new Error("completion_conflict");
    });
  }

  private get(runId: string, id: string, db = this.database) {
    return db.prepare("SELECT * FROM workflow_run_actions WHERE run_id=? AND id=? AND kind='knowledge-proposal'")
      .bind(runId, id).first<ActionRow>();
  }

  async terminalOutput(detail: RunDetail, nodeId: string, activationId: string | undefined, text: string) {
    let recorded = activationId ? await this.get(detail.run.id, actionId(detail.run.id, nodeId, activationId)) : null;
    if (!recorded || recorded.content !== text) throw new Error("workflow_output_unverified");
    const terminalActionId = recorded.id;
    const seen = new Set<string>();
    while (recorded && !seen.has(recorded.id)) {
      seen.add(recorded.id);
      const sourceId: string = recorded.source_node_id;
      const activation: string = recorded.source_activation_id;
      const attempt = detail.attempts.find(item => item.stepId === sourceId && item.graphActivationId === activation &&
        item.status === "succeeded" && item.outputText === text);
      if (attempt) return { text, url: attempt.outputExternalUrl, actionId: terminalActionId };
      recorded = await this.get(detail.run.id, actionId(detail.run.id, sourceId, activation));
    }
    return { text, url: undefined, actionId: terminalActionId };
  }

  /** Call in the same fenced transaction that completes the Run. */
  async publish(runId: string, terminalActionId?: string) {
    const { results } = await this.database.prepare(`UPDATE workflow_run_actions a
      SET response_section = CASE WHEN NOT verified.has_text THEN NULL WHEN a.id=? THEN 'terminal' ELSE 'section' END
      FROM committed_workflow_knowledge_actions(?) verified
      WHERE a.id = verified.action_id RETURNING a.id`)
      .bind(terminalActionId ?? null, runId).all<{ id: string }>();
    if (terminalActionId && !results.some(row => row.id === terminalActionId)) throw new Error("workflow_output_unverified");
  }

  async sections(runId: string, finalOutput: string | null): Promise<ResponseSection[]> {
    let final: ResponseSection = { id: `${runId}:output`, markdown: finalOutput ?? "" };
    const { results } = await this.database.prepare(`SELECT id,label,response_section,sequence FROM workflow_run_actions
      WHERE run_id=? AND response_section IS NOT NULL ORDER BY sequence,id`)
      .bind(runId).all<Pick<ActionRow, "id" | "label" | "response_section" | "sequence">>();
    const sections: ResponseSection[] = [];
    for (const row of results) {
      const section = { id: row.id, label: row.label, sequence: row.sequence, actions: [{ kind: "knowledge-proposal" as const, id: row.id }] };
      if (row.response_section === "terminal") final = { ...final, label: section.label, actions: section.actions };
      else sections.push(section);
    }
    return [...sections, final];
  }

  /** Fully load sections only where they could fit in an exact exchange. */
  async historySections(runIds: string[]) {
    const sections = new Map<string, HistorySection[]>();
    if (!runIds.length) return sections;
    const { results } = await this.database.prepare(`SELECT run_id,id,label,response_section,sequence, bytes_through<=? AS complete,
      CASE WHEN response_section='terminal' THEN NULL WHEN bytes_through<=? THEN content
           WHEN bytes_through-octet_length(content)<? THEN left(content,384) END AS markdown
      FROM (SELECT run_id,id,label,content,sequence,response_section, sum(octet_length(content)) OVER (
        PARTITION BY run_id ORDER BY sequence,id ROWS UNBOUNDED PRECEDING) AS bytes_through
        FROM workflow_run_actions WHERE run_id=ANY(?::text[]) AND response_section IS NOT NULL) AS response
      ORDER BY run_id,sequence,id`)
      .bind(MAX_CONVERSATION_INPUT_BYTES, MAX_CONVERSATION_INPUT_BYTES, MAX_CONVERSATION_INPUT_BYTES, runIds)
      .all<{ run_id: string; id: string; label: string; complete: boolean; markdown: string | null; sequence: number; response_section: "section" | "terminal" }>();
    for (const { run_id, id, label, complete, markdown, response_section, sequence } of results) {
      const response = sections.get(run_id) ?? [];
      response.push({ id, label, complete, markdown: markdown ?? "", sequence, terminal: response_section === "terminal" });
      sections.set(run_id, response);
    }
    return sections;
  }

  async require(detail: RunDetail, id: string) {
    if (detail.run.status !== "succeeded") throw new Error("workflow_action_not_found");
    const row = await this.get(detail.run.id, id);
    const plan = detail.run.executionPlan;
    const node = row && plan && "planVersion" in plan ? plan.nodes.find(item => item.id === row.node_id) : undefined;
    if (!row?.response_section || !row.content.trim() || node?.blockType !== "knowledge-proposal" ||
        id !== actionId(detail.run.id, row.node_id, row.activation_id) || row.label !== (node.config.label ?? "Knowledge finding")) {
      throw new Error("workflow_action_not_found");
    }
    return row;
  }
}

export function knowledgeFromWorkflowAction(run: WorkflowRun, action: ActionRow): KnowledgeDocument {
  const source = `workflow-run:${run.id}:block:${action.source_node_id}:activation:${action.source_activation_id}`;
  const prefix = utf8Prefix(action.content, MAX_KNOWLEDGE_BYTES - 4096);
  const origin = run.compositionSnapshot?.nodes.find(node => node.executionNodeId === action.source_node_id);
  const revision = run.compositionSnapshot?.dependencies.find(dependency => dependency.workflowId === origin?.workflowId)?.revision ?? run.workflowRevision;
  return {
    metadata: { id: `finding-${action.id.slice(0, 32)}`, title: action.label, type: "finding", status: "active", tags: [],
      workflowIds: [], agentIds: [], runIds: [run.id], related: [], supersedes: [],
      evidence: [{ source, revision }] },
    body: prefix + (prefix === action.content ? "" : "\n\n[Excerpt. Open the conversation section or source Run for the complete output.]"),
  };
}
