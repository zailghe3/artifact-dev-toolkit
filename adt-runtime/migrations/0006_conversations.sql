ALTER TABLE workflow_runs ADD COLUMN execution_policy text CHECK (execution_policy = 'read-only');
ALTER TABLE workflow_runs ADD CONSTRAINT workflow_run_repository_identity UNIQUE (id, repository_id);

CREATE TABLE conversations (
  id uuid PRIMARY KEY,
  repository_id bigint NOT NULL,
  repository_scope text NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('agent', 'workflow')),
  target_id text NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, repository_id)
);

CREATE INDEX conversations_history ON conversations (repository_scope, updated_at DESC, id DESC);

CREATE TABLE conversation_turns (
  conversation_id uuid NOT NULL,
  repository_id bigint NOT NULL,
  id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  run_id text NOT NULL UNIQUE,
  message text NOT NULL CHECK (octet_length(message) BETWEEN 1 AND 65536),
  request_digest text NOT NULL,
  definition_digest text NOT NULL,
  target_name text NOT NULL,
  context_json json NOT NULL,
  PRIMARY KEY (conversation_id, ordinal),
  UNIQUE (conversation_id, id),
  FOREIGN KEY (conversation_id, repository_id) REFERENCES conversations (id, repository_id),
  FOREIGN KEY (run_id, repository_id) REFERENCES workflow_runs (id, repository_id)
);

-- A bounded provider summary is attempted at most once at a conversation head.
-- A crashed or uncertain attempt falls back to local excerpts after the deadline.
CREATE TABLE conversation_summary_attempts (
  conversation_id uuid NOT NULL,
  after_turn_id uuid NOT NULL,
  generation integer NOT NULL,
  input_digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  settled boolean NOT NULL DEFAULT false,
  summary text,
  PRIMARY KEY (conversation_id, after_turn_id, generation),
  FOREIGN KEY (conversation_id, after_turn_id) REFERENCES conversation_turns (conversation_id, id)
);

CREATE TABLE workflow_run_actions (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES workflow_runs (id),
  node_id text NOT NULL,
  activation_id text NOT NULL,
  source_node_id text NOT NULL,
  source_activation_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  kind text NOT NULL CHECK (kind = 'knowledge-proposal'),
  label text NOT NULL,
  content text NOT NULL CHECK (octet_length(content) <= 262144),
  UNIQUE (run_id, node_id, activation_id)
);

CREATE INDEX workflow_run_actions_output ON workflow_run_actions (run_id, node_id, sequence DESC, id DESC);

ALTER TABLE advisor_knowledge_proposals ADD COLUMN source_action_id text REFERENCES workflow_run_actions (id);
ALTER TABLE advisor_knowledge_proposals ADD CONSTRAINT knowledge_proposal_action_once
  UNIQUE (repository_scope, owner_id, source_action_id);
