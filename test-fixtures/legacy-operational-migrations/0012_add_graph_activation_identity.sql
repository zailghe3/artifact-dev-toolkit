-- Generic planVersion-2 Agent attempts are admitted lazily from stable LangGraph task identities.
ALTER TABLE workflow_step_attempts ADD COLUMN graph_activation_id TEXT;
CREATE UNIQUE INDEX workflow_attempt_graph_activation
ON workflow_step_attempts(run_id, step_id, graph_activation_id, attempt)
WHERE graph_activation_id IS NOT NULL;
