import type { PostgresWorkflowDatabase } from "../adt-runtime/src/workflow-database.ts";

export type ActivityCursor = { at: string; id: string };
export type RunActivity = {
  id: string; nodeId: string; name: string; blockType: string; state: string; at: string;
  startedAt?: string; completedAt?: string; respondedAt?: string;
  iteration?: number; attempt?: number; route?: string; interactionKind?: string;
  parallel?: boolean;
};
export type RunActivityPage = { entries: RunActivity[]; before: ActivityCursor | null; completed: number; revision?: string; observedAt?: string };

type ActivityRow = {
  id: string; activation_id: string; node_id: string; state: string; at: string;
  started_at: string | null; completed_at: string | null; responded_at: string | null;
  iteration: number | null; attempt: number | null; route: string | null; interaction_kind: string | null;
  cursor_at: string; block_type: string; name: string; count_completed: number;
  visit: number; parallel: boolean; revision: string; observed_at: string;
};
const PAGE_SIZE = 14;

export async function workflowRunActivity(db: PostgresWorkflowDatabase, runId: string, before?: ActivityCursor): Promise<RunActivityPage> {
  const { results } = await db.prepare(`WITH run AS (SELECT * FROM workflow_runs WHERE id=?),
    committed AS (SELECT *, count(*) OVER (PARTITION BY checkpoint_id)>1 AS parallel FROM committed_workflow_activities(?)),
    events AS (
      SELECT concat('attempt-',a.ordinal) AS id,a.graph_activation_id AS activation_id,a.step_id AS node_id,
        CASE a.status WHEN 'pending' THEN CASE WHEN r.status='failed' THEN 'abandoned'
          WHEN r.status='cancelled' THEN 'cancelled' ELSE 'queued' END
          WHEN 'starting' THEN CASE WHEN r.status='failed' THEN 'abandoned' ELSE 'running' END
          WHEN 'waiting_provider' THEN CASE WHEN r.status='failed' THEN 'abandoned' ELSE 'running' END
          WHEN 'succeeded' THEN 'completed' ELSE a.status END AS state,
        COALESCE(a.started_at,c.started_at,r.created_at) AS at,a.started_at,a.completed_at,NULL::timestamptz AS responded_at,
        a.iteration,a.attempt,c.route,NULL AS interaction_kind
      FROM workflow_step_attempts a JOIN run r ON a.run_id=r.id LEFT JOIN committed c ON a.graph_activation_id=c.activation_id
      UNION ALL
      SELECT concat('block-',c.activation_id),c.activation_id,c.node_id,'completed',c.started_at,
        c.started_at,c.completed_at,NULL,NULL,NULL,c.route,NULL
      FROM committed c CROSS JOIN run r WHERE NOT EXISTS (
        SELECT 1 FROM workflow_step_attempts a WHERE a.run_id=r.id AND a.graph_activation_id=c.activation_id
      ) AND NOT EXISTS (SELECT 1 FROM workflow_approvals a WHERE a.run_id=r.id AND a.activation_id=c.activation_id)
      UNION ALL
      SELECT concat('interaction-',a.request_id),a.activation_id,a.node_id,
        CASE WHEN c.activation_id IS NOT NULL OR a.consumed_at IS NOT NULL AND a.interaction_version IS NULL THEN 'completed'
          WHEN r.workflow_generation<>a.workflow_generation THEN 'superseded'
          WHEN r.status IN ('cancelled','cancelling') THEN 'cancelled'
          WHEN r.status IN ('failed','succeeded','rejected') THEN 'abandoned'
          WHEN a.approved_at IS NOT NULL OR a.responded_at IS NOT NULL THEN 'resuming' ELSE 'waiting' END,
        a.requested_at,a.requested_at,COALESCE(c.completed_at,a.consumed_at,r.cancel_requested_at,r.completed_at),
        COALESCE(a.responded_at,a.approved_at),NULL,NULL,c.route,COALESCE(a.request_json->>'kind','approval')
      FROM workflow_approvals a JOIN run r ON a.run_id=r.id LEFT JOIN committed c ON a.activation_id=c.activation_id
      UNION ALL
      SELECT concat('tool-',a.id),c.activation_id,c.node_id,
        CASE WHEN a.status='pending' THEN 'waiting' ELSE a.status END,to_timestamp(a.created_at/1000.0),
        to_timestamp(a.created_at/1000.0),to_timestamp(a.decided_at/1000.0),to_timestamp(a.decided_at/1000.0),
        c.iteration,c.attempt,NULL,'tool'
      FROM run r JOIN agent_continuations c ON c.run_id=r.id
      JOIN agent_tool_invocations i ON i.continuation_id=c.id JOIN agent_tool_approvals a ON a.invocation_id=i.id
      UNION ALL
      SELECT concat('block-',failed_graph_activation_id),failed_graph_activation_id,current_step_id,'failed',
        completed_at,NULL,completed_at,NULL,NULL,NULL,NULL,NULL
      FROM run WHERE status='failed' AND failed_graph_activation_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM committed c WHERE c.activation_id=run.failed_graph_activation_id
      ) AND NOT EXISTS (
        SELECT 1 FROM workflow_step_attempts a WHERE a.run_id=run.id
          AND a.graph_activation_id=run.failed_graph_activation_id AND a.status='failed'
      )
    ), numbered AS (
      SELECT e.*,row_number() OVER (PARTITION BY e.node_id,e.interaction_kind ORDER BY e.at,e.id COLLATE "C") AS visit,
        COALESCE(c.parallel,false) AS parallel FROM events e LEFT JOIN committed c ON c.activation_id=e.activation_id
    ), snapshot AS (
      SELECT count(DISTINCT COALESCE(activation_id,id)) FILTER (WHERE state='completed') AS count_completed,
        md5(COALESCE(string_agg(row_to_json(e)::text,E'\\n' ORDER BY e.id COLLATE "C"), '')) AS revision FROM numbered e
    ), page AS (
      SELECT * FROM numbered
      ${before ? 'WHERE (at,id COLLATE "C")<(?::timestamptz,?)' : ""}
      ORDER BY at DESC,id COLLATE "C" DESC LIMIT ?
    )
    SELECT e.*,s.count_completed,s.revision,
      to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed_at,
      to_char(e.at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
      node->>'blockType' AS block_type,
      COALESCE(r.agent_snapshots_json->(node->'config'->>'agentId')->>'name',origin->>'displayPath',e.node_id) AS name
    FROM snapshot s CROSS JOIN run r LEFT JOIN page e ON true
    LEFT JOIN LATERAL (
      SELECT item AS node FROM json_array_elements(r.execution_plan_json->'nodes') item WHERE item->>'id'=e.node_id LIMIT 1
    ) AS frozen ON true
    LEFT JOIN LATERAL (
      SELECT item AS origin FROM json_array_elements(r.composition_snapshot_json->'nodes') item
      WHERE item->>'executionNodeId'=e.node_id LIMIT 1
    ) AS provenance ON true
    ORDER BY e.at DESC,e.id COLLATE "C" DESC`)
    .bind(runId, runId, ...(before ? [before.at, before.id] : []), PAGE_SIZE + 1).all<ActivityRow>();
  const rows = results.filter(row => row.id !== null);
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    entries: page.map(row => ({
      id: row.id, nodeId: row.node_id, name: row.name, blockType: row.block_type, state: row.state, at: row.cursor_at,
      startedAt: row.started_at ?? undefined, completedAt: row.completed_at ?? undefined, respondedAt: row.responded_at ?? undefined,
      iteration: row.iteration ?? row.visit, attempt: row.attempt ?? undefined, route: row.route ?? undefined, parallel: row.parallel,
      interactionKind: row.interaction_kind ?? undefined,
    })),
    before: last && rows.length > PAGE_SIZE ? { at: last.cursor_at, id: last.id } : null,
    completed: results[0]?.count_completed ?? 0,
    revision: results[0]?.revision,
    observedAt: results[0]?.observed_at,
  };
}
