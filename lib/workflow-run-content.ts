import type { PostgresWorkflowDatabase } from "../adt-runtime/src/workflow-database.ts";
import { MAX_CONVERSATION_INPUT_BYTES } from "../adt-runtime/src/conversation-contract.ts";
import type { HistorySection } from "./conversation-context.ts";
import type { ResponseSection } from "./conversation-types.ts";
import { WorkflowInteractions, type WorkflowInteractionView } from "./workflow-interactions.ts";

export type RunContentCursor = { sequence: number; id: string };
export type RunContentItem =
  | { kind: "display"; sequence: number; section: ResponseSection }
  | { kind: "interaction"; id: string; sequence: number; nodeId: string; question: string;
      interactionKind: string; responsePreview?: string; responded: boolean };
export type RunContentPage = { items: RunContentItem[]; before: RunContentCursor | null; revision?: string; observedAt?: string; active?: WorkflowInteractionView };

type ContentRow = {
  id: string; kind: "display" | "interaction"; node_id: string; sequence: number; label: string | null;
  question: string | null; interaction_kind: string | null; preview: string | null; complete: boolean;
  responded: boolean; active: boolean; terminal: boolean;
};

const PAGE_SIZE = 12;
const selectedDecision = `SELECT choice FROM json_array_elements(
  CASE WHEN a.request_json->>'kind'='decision' THEN a.request_json->'options' ELSE '[]'::json END) AS choice
  WHERE choice->>'id'=a.response_json->>'optionId'`;
const decisionLabel = `(SELECT choice->>'title' FROM (${selectedDecision}) selected)`;
const outcomeLabel = `CASE a.response_json->>'outcome' WHEN 'approve' THEN 'Approved'
  WHEN 'revise' THEN 'Revision requested' WHEN 'reject' THEN 'Rejected' END`;

export class WorkflowRunContent {
  constructor(private readonly db: PostgresWorkflowDatabase) {}

  async display(runId: string, activationId: string) {
    const row = await this.db.prepare("SELECT content AS markdown FROM committed_workflow_displays(?) WHERE activation_id=?")
      .bind(runId, activationId).first<{ markdown: string }>();
    if (!row) throw new Error("workflow_display_not_found");
    return row;
  }

  /** Capture the whole committed output list in one read, independently of the visible timeline. */
  async outputs(runId: string): Promise<ResponseSection[]> {
    const { results } = await this.db.prepare(`WITH run AS (
      SELECT id,status,final_output,execution_plan_json->>'terminalNodeId' AS terminal_node
      FROM workflow_runs WHERE id=?
    ), displayed AS (
      SELECT d.activation_id AS id,d.sequence,d.node_id FROM run r CROSS JOIN LATERAL committed_workflow_displays(r.id) d
    ), sections AS (
      SELECT id,sequence,'display' AS source,NULL AS markdown FROM displayed
      UNION ALL
      SELECT a.id,a.sequence,'knowledge',NULL FROM workflow_run_actions a JOIN run r ON a.run_id=r.id
        WHERE r.status='succeeded' AND a.kind='knowledge-proposal' AND a.response_section='section'
      UNION ALL
      SELECT r.id || ':output',2147483647,'final',COALESCE(r.final_output,'') FROM run r
        WHERE r.status='succeeded' AND NOT EXISTS (SELECT 1 FROM displayed d WHERE d.node_id=r.terminal_node)
    ) SELECT id,source,markdown FROM sections ORDER BY sequence,id COLLATE "C"`)
      .bind(runId).all<{ id: string; source: "display" | "knowledge" | "final"; markdown: string | null }>();
    return results.map(({ id, source, markdown }) => ({
      id,
      ...(source === "display" ? { contentSource: "display" as const } : {}),
      ...(markdown === null ? {} : { markdown }),
    }));
  }

  async page(runId: string, before?: RunContentCursor): Promise<RunContentPage> {
    const { results } = await this.db.prepare(`WITH events AS (
      SELECT d.activation_id AS id, 'display' AS kind,d.node_id,d.sequence,d.label,
        NULL AS question,NULL AS interaction_kind,
        CASE WHEN octet_length(d.content)<=4096 THEN d.content ELSE left(d.content, 1000) END AS preview,
        octet_length(d.content)<=4096 AS complete,false AS responded,false AS active,
        r.status='succeeded' AND r.execution_plan_json->>'terminalNodeId'=d.node_id AS terminal
      FROM committed_workflow_displays(?) d JOIN workflow_runs r ON r.id=?
      UNION ALL
      SELECT a.request_id,'interaction',a.node_id,a.interaction_sequence,NULL,a.message,a.request_json->>'kind',
        CASE a.response_json->>'kind'
          WHEN 'decision' THEN left(concat_ws(E'\\n',${decisionLabel},NULLIF(a.response_json->>'guidance','')),600)
          WHEN 'approval' THEN left(concat_ws(E'\\n',${outcomeLabel},NULLIF(a.response_json->>'feedback','')),600)
          ELSE left(a.response_json->>'text',600) END,
        false,a.response_json IS NOT NULL,
        a.workflow_generation=r.workflow_generation AND a.consumed_at IS NULL AND r.status='waiting_approval'
          AND r.cancel_requested_at IS NULL,
        false
      FROM workflow_approvals a JOIN workflow_runs r ON r.id=a.run_id
      WHERE a.run_id=? AND a.interaction_version IS NOT NULL
    )
    SELECT page.*,snapshot.revision,
      to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed_at FROM (
      SELECT md5(COALESCE(string_agg(row_to_json(e)::text,E'\\n' ORDER BY e.id COLLATE "C"), '')) AS revision FROM events e
    ) snapshot LEFT JOIN LATERAL (
      SELECT * FROM events ${before ? 'WHERE (sequence,id COLLATE "C") < (?,?)' : ""}
      ORDER BY sequence DESC,id COLLATE "C" DESC LIMIT ?
    ) page ON true ORDER BY page.sequence DESC,page.id COLLATE "C" DESC`)
      .bind(runId, runId, runId, ...(before ? [before.sequence, before.id] : []), PAGE_SIZE + 1)
      .all<ContentRow & { revision: string; observed_at: string }>();
    const rows = results.filter(row => row.id !== null);
    const selected = rows.slice(0, PAGE_SIZE);
    const oldest = selected.at(-1);
    const active = !before && selected.find(row => row.active)?.id;
    return {
      items: selected.reverse().map(row => row.kind === "display"
        ? { kind: "display", sequence: row.sequence, section: { id: row.id, label: row.label ?? (row.terminal ? "Final response" : "Displayed output"),
            contentSource: "display", terminal: row.terminal,
            ...(row.complete ? { markdown: row.preview ?? "" } : { preview: row.preview ?? "" }) } }
        : { kind: "interaction", id: row.id, sequence: row.sequence, nodeId: row.node_id, question: row.question ?? "",
            interactionKind: row.interaction_kind ?? "", responsePreview: row.preview ?? undefined, responded: row.responded }),
      before: oldest && rows.length > PAGE_SIZE ? { sequence: oldest.sequence, id: oldest.id } : null,
      revision: results[0]?.revision,
      observedAt: results[0]?.observed_at,
      active: active ? await new WorkflowInteractions(this.db).read(runId, active) : undefined,
    };
  }

  /** Keep only visible content in the context projection, with cumulative per-Run byte bounds. */
  async history(runIds: string[]) {
    const history = new Map<string, HistorySection[]>();
    if (!runIds.length) return history;
    const { results } = await this.db.prepare(`WITH visible AS (
      SELECT r.id AS run_id,d.activation_id AS id,d.sequence,COALESCE(d.label,'Displayed output') AS label,
        d.content,r.execution_plan_json->>'terminalNodeId'=d.node_id AS terminal,'display' AS source,true AS available
      FROM workflow_runs r CROSS JOIN LATERAL committed_workflow_displays(r.id) d WHERE r.id=ANY(?::text[])
      UNION ALL
      SELECT a.run_id,a.request_id,a.interaction_sequence,'Workflow interaction',
        concat_ws(E'\\n',concat('Workflow question: ',a.message),
          CASE WHEN a.request_json->>'kind'='input' AND a.request_json->>'message' IS NOT NULL
            THEN concat('Workflow explanation: ',a.request_json->>'message') END,
          CASE a.request_json->>'kind'
            WHEN 'approval' THEN concat('Reviewed Workflow content: ',a.request_json->>'reviewed')
            WHEN 'edit' THEN concat('Original Workflow content: ',a.request_json->>'original')
            WHEN 'input' THEN CASE WHEN a.request_json->>'showContext'='true'
              THEN concat('Displayed Workflow context: ',a.request_json->>'sourceContext') END END,
          CASE a.response_json->>'kind'
            WHEN 'decision' THEN concat_ws(E'\\n',
              concat('Human selected: ',selected.choice->>'title'),
              concat('Selected option ID: ',selected.choice->>'id'),
              CASE WHEN selected.choice->>'description' IS NOT NULL
                THEN concat('Selected option description: ',selected.choice->>'description') END,
              concat('Selected option value (Workflow content): ',COALESCE(selected.choice->>'value',selected.choice->>'title')))
            WHEN 'approval' THEN concat('Human outcome: ',${outcomeLabel})
            WHEN 'edit' THEN concat('Exact text confirmed by human: ',a.response_json->>'text')
            ELSE concat('Human response: ',a.response_json->>'text') END,
          CASE WHEN a.response_json->>'feedback' IS NOT NULL THEN concat('Human feedback: ',a.response_json->>'feedback')
            WHEN a.response_json->>'guidance' IS NOT NULL THEN concat('Human guidance: ',a.response_json->>'guidance') END,
          CASE WHEN a.request_json->>'kind'='decision' THEN '[Other offered options omitted from conversation context.]' END,
          CASE WHEN a.request_json->>'kind'='input' AND a.request_json->>'showContext'='false' AND a.request_json->>'sourceContext'<>''
            THEN '[Hidden input context omitted from conversation context.]' END),
        false,'interaction',a.request_json->>'kind'<>'decision' OR selected.choice IS NOT NULL
      FROM workflow_approvals a LEFT JOIN LATERAL (${selectedDecision}) selected ON true
      WHERE a.run_id=ANY(?::text[]) AND a.response_json IS NOT NULL AND a.consumed_at IS NOT NULL
    ), bounded AS (
      SELECT *,sum(CASE WHEN terminal THEN 0 ELSE octet_length(content) END) OVER (PARTITION BY run_id ORDER BY sequence,id) AS bytes_through
      FROM visible
    )
    SELECT run_id,id,sequence,label,terminal,source,available AND bytes_through<=? AS complete,
      CASE WHEN terminal THEN '' WHEN bytes_through<=? THEN content
        WHEN bytes_through-octet_length(content)<? THEN left(content,384) ELSE '' END AS markdown
    FROM bounded ORDER BY run_id,sequence,id`)
      .bind(runIds, runIds, MAX_CONVERSATION_INPUT_BYTES, MAX_CONVERSATION_INPUT_BYTES, MAX_CONVERSATION_INPUT_BYTES)
      .all<HistorySection & { run_id: string }>();
    for (const { run_id, ...item } of results) {
      const sections = history.get(run_id) ?? [];
      sections.push(item);
      history.set(run_id, sections);
    }
    return history;
  }
}
