ALTER TABLE workflow_approvals DROP CONSTRAINT workflow_approvals_status_check;
ALTER TABLE workflow_approvals
  ADD COLUMN interaction_version integer,
  ADD COLUMN interaction_sequence integer,
  ADD COLUMN request_json json,
  ADD COLUMN response_json json,
  ADD COLUMN responder_id bigint,
  ADD COLUMN responder_login text,
  ADD COLUMN responded_at timestamptz,
  ADD CONSTRAINT workflow_approval_contract CHECK (
    (interaction_version IS NULL AND interaction_sequence IS NULL AND request_json IS NULL
      AND response_json IS NULL AND responder_id IS NULL AND responder_login IS NULL AND responded_at IS NULL
      AND status IN ('pending', 'approved'))
    OR
    (interaction_version IS NOT NULL AND interaction_version > 0 AND interaction_sequence > 0
      AND interaction_sequence IS NOT NULL AND request_json IS NOT NULL AND approved_at IS NULL
      AND ((status = 'pending' AND responded_at IS NULL AND response_json IS NULL AND responder_id IS NULL
        AND responder_login IS NULL AND consumed_at IS NULL)
        OR (status = 'responded' AND responded_at IS NOT NULL AND response_json IS NOT NULL
          AND responder_id IS NOT NULL AND responder_login IS NOT NULL)))
  );

ALTER TABLE workflow_runs DROP CONSTRAINT workflow_runs_status_check;
ALTER TABLE workflow_runs ADD CONSTRAINT workflow_runs_status_check
  CHECK (status IN ('queued','running','waiting_approval','cancelling','succeeded','failed','cancelled','rejected'));
ALTER TABLE workflow_runs ADD COLUMN failed_graph_activation_id text;

CREATE FUNCTION committed_workflow_activities(target_run_id text)
RETURNS TABLE (checkpoint_id text, activation_id text, node_id text, sequence integer,
  route text, started_at timestamptz, completed_at timestamptz)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE lineage(checkpoint_id, parent_checkpoint_id, created_at) AS (
    (SELECT checkpoint_id, parent_checkpoint_id, created_at FROM langgraph_checkpoints
     WHERE run_id = target_run_id AND checkpoint_namespace = ''
     ORDER BY created_at DESC, checkpoint_id DESC LIMIT 1)
    UNION
    SELECT parent.checkpoint_id, parent.parent_checkpoint_id, parent.created_at
    FROM langgraph_checkpoints parent
    JOIN lineage child ON parent.checkpoint_id = child.parent_checkpoint_id
    WHERE parent.run_id = target_run_id AND parent.checkpoint_namespace = ''
  )
  SELECT DISTINCT ON (w.task_id) w.checkpoint_id, w.task_id, w.value_json->>'nodeId',
    (w.value_json->>'sequence')::integer, w.value_json->>'route', parent.created_at, child.created_at
  FROM lineage child
  JOIN lineage parent ON parent.checkpoint_id = child.parent_checkpoint_id
  JOIN langgraph_checkpoint_writes w ON w.checkpoint_id = parent.checkpoint_id
  WHERE w.run_id = target_run_id AND w.checkpoint_namespace = '' AND w.channel = 'activity'
    AND w.value_json->>'activationId' = w.task_id
  ORDER BY w.task_id, child.created_at DESC;
$$;

CREATE FUNCTION committed_workflow_displays(target_run_id text)
RETURNS TABLE (activation_id text, node_id text, sequence integer, label text, content text)
LANGUAGE sql STABLE AS $$
  SELECT a.activation_id, a.node_id, a.sequence, NULLIF(node->'config'->>'label', ''), result->>'output'
  FROM committed_workflow_activities(target_run_id) a
  JOIN workflow_runs r ON r.id = target_run_id
  JOIN langgraph_checkpoint_writes w ON w.run_id = r.id AND w.checkpoint_namespace = ''
    AND w.checkpoint_id = a.checkpoint_id AND w.task_id = a.activation_id AND w.channel = 'outputs'
  CROSS JOIN LATERAL json_array_elements(CASE WHEN json_typeof(r.execution_plan_json->'nodes') = 'array'
    THEN r.execution_plan_json->'nodes' ELSE '[]'::json END) AS node
  CROSS JOIN LATERAL json_array_elements(CASE WHEN json_typeof(w.value_json) = 'array'
    THEN w.value_json ELSE '[]'::json END) AS result
  WHERE node->>'id' = a.node_id AND node->>'blockType' = 'display-output' AND node->>'blockVersion' = '1'
    AND result->>'nodeId' = a.node_id AND result->>'activationId' = a.activation_id AND result->>'output' IS NOT NULL;
$$;
