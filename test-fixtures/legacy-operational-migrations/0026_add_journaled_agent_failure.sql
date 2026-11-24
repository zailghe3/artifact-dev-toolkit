ALTER TABLE agent_continuations ADD COLUMN failure_json TEXT;
CREATE INDEX agent_continuation_attempt_failure ON agent_continuations(run_id,node_id,activation_id,iteration,attempt,generation) WHERE failure_json IS NOT NULL;
