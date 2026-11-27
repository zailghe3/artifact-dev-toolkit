import type { GraphKnowledgeOutput } from "../adt-runtime/src/langgraph.ts";
import type { PostgresWorkflowDatabase } from "../adt-runtime/src/workflow-database.ts";
import { agentDigest } from "./agent-journal.ts";
import { MAX_KNOWLEDGE_BYTES, type KnowledgeDocument } from "./advisor-knowledge.ts";
import { utf8Prefix } from "./conversation-context.ts";
import type { ResponseSection } from "./conversation-types.ts";
import type { RunDetail, WorkflowRun } from "./workflow-storage.ts";

type ActionRow = {
  id: string; node_id: string; activation_id: string; source_node_id: string; source_activation_id: string;
  sequence: number; label: string; content: string;
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

  async sections(runId: string, finalOutput: string | null): Promise<ResponseSection[]> {
    const final: ResponseSection = { id: `${runId}:output`, markdown: finalOutput ?? "" };
    const { results } = await this.database.prepare(`SELECT id,label,is_final FROM (
      SELECT DISTINCT ON (node_id) id,label,sequence,content=? AS is_final,content
      FROM workflow_run_actions WHERE run_id=? AND kind='knowledge-proposal'
      ORDER BY node_id, sequence DESC, id DESC
    ) AS latest WHERE length(btrim(content)) > 0 ORDER BY sequence,id`)
      .bind(finalOutput, runId).all<{ id: string; label: string; is_final: boolean }>();
    const sections: ResponseSection[] = [final];
    for (const row of results) {
      const action = { kind: "knowledge-proposal" as const, id: row.id };
      if (row.is_final) (final.actions ??= []).push(action);
      else sections.push({ id: row.id, label: row.label, actions: [action] });
    }
    return sections;
  }

  async require(detail: RunDetail, id: string) {
    if (detail.run.status !== "succeeded") throw new Error("workflow_action_not_found");
    const row = await this.get(detail.run.id, id);
    const plan = detail.run.executionPlan;
    const node = row && plan && "planVersion" in plan ? plan.nodes.find(item => item.id === row.node_id) : undefined;
    if (!row || !row.content.trim() || node?.blockType !== "knowledge-proposal" ||
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
