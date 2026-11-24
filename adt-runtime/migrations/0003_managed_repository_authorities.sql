CREATE TABLE managed_repository_authorities (
  run_id text NOT NULL REFERENCES workflow_runs ON DELETE CASCADE,
  agent_id text NOT NULL,
  authority text NOT NULL CHECK (length(authority) = 43),
  PRIMARY KEY (run_id, agent_id)
);
