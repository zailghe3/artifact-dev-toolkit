ALTER TABLE workflow_run_actions ADD COLUMN response_section text CHECK (response_section IN ('section', 'terminal'));

CREATE INDEX workflow_run_visible_actions ON workflow_run_actions (run_id, sequence, id) WHERE response_section IS NOT NULL;
CREATE UNIQUE INDEX workflow_run_terminal_action ON workflow_run_actions (run_id) WHERE response_section = 'terminal';

-- A block records its candidate before the graph commits the corresponding write.
-- Only writes applied on the completed checkpoint's lineage can become response sections.
CREATE FUNCTION committed_workflow_knowledge_actions(target_run_id text) RETURNS TABLE (action_id text, has_text boolean)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE lineage(checkpoint_id, parent_checkpoint_id) AS (
    (SELECT checkpoint_id, parent_checkpoint_id FROM langgraph_checkpoints
     WHERE run_id = target_run_id AND checkpoint_namespace = ''
     ORDER BY created_at DESC, checkpoint_id DESC LIMIT 1)
    UNION
    SELECT parent.checkpoint_id, parent.parent_checkpoint_id FROM langgraph_checkpoints parent
    JOIN lineage child ON parent.checkpoint_id = child.parent_checkpoint_id
    WHERE parent.run_id = target_run_id AND parent.checkpoint_namespace = ''
  )
  -- Match JavaScript trim so blank outputs can complete without offering a review action.
  SELECT a.id, btrim(a.content, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') <> ''
  FROM workflow_run_actions a JOIN workflow_runs r ON a.run_id = r.id
  WHERE a.run_id = target_run_id AND a.kind = 'knowledge-proposal'
    AND EXISTS (
      SELECT 1 FROM json_array_elements(CASE WHEN json_typeof(r.execution_plan_json->'nodes') = 'array'
        THEN r.execution_plan_json->'nodes' ELSE '[]'::json END) AS node
      WHERE node->>'id' = a.node_id AND node->>'blockType' = 'knowledge-proposal'
        AND COALESCE(node->'config'->>'label', 'Knowledge finding') = a.label
    )
    AND EXISTS (
      SELECT 1 FROM lineage c JOIN langgraph_checkpoint_writes w ON w.checkpoint_id = c.parent_checkpoint_id
      CROSS JOIN LATERAL json_array_elements(CASE WHEN json_typeof(w.value_json) = 'array' THEN w.value_json ELSE '[]'::json END) AS output
      WHERE w.run_id = target_run_id AND w.checkpoint_namespace = '' AND w.channel = 'outputs'
        AND w.task_id = a.activation_id AND output->>'activationId' = a.activation_id
        AND output->>'nodeId' = a.node_id AND output->>'sequence' = a.sequence::text AND output->>'output' = a.content
    );
$$;

-- A database already running the Conversations preview keeps its proven actions.
WITH completed AS (
  SELECT r.id, r.final_output, r.execution_plan_json->>'terminalNodeId' AS terminal_node_id
  FROM workflow_runs r WHERE r.status = 'succeeded'
    AND EXISTS (SELECT 1 FROM workflow_run_actions a WHERE a.run_id = r.id)
)
UPDATE workflow_run_actions a SET response_section = CASE
  WHEN NOT verified.has_text THEN NULL
  WHEN a.node_id = c.terminal_node_id AND a.content = c.final_output THEN 'terminal' ELSE 'section' END
FROM completed c CROSS JOIN LATERAL committed_workflow_knowledge_actions(c.id) verified
WHERE a.id = verified.action_id;
