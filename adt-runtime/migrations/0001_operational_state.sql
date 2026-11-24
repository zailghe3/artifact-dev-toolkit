CREATE TABLE installation (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  root_key_fingerprint text NOT NULL CHECK (root_key_fingerprint ~ '^[0-9a-f]{64}$'),
  active_key_version integer NOT NULL CHECK (active_key_version > 0),
  initialized_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workflow_runs (
  id text PRIMARY KEY,
  engine_version text NOT NULL CHECK (engine_version = '2'),
  workflow_id text NOT NULL,
  workflow_revision text NOT NULL,
  workflow_snapshot_json json NOT NULL,
  agent_snapshots_json json NOT NULL,
  agent_revisions_json json NOT NULL,
  connection_snapshots_json json NOT NULL,
  initial_input text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','waiting_approval','cancelling','succeeded','failed','cancelled')),
  current_step_id text,
  transition_count integer NOT NULL DEFAULT 0,
  state_version integer NOT NULL DEFAULT 0,
  workflow_instance_id text UNIQUE,
  reserved_workflow_instance_id text,
  workflow_generation integer NOT NULL DEFAULT 1 CHECK (workflow_generation > 0),
  workflow_launch_state text NOT NULL DEFAULT 'unclaimed'
    CHECK (workflow_launch_state IN ('unclaimed','launching','attached','launch_failed')),
  workflow_launch_failure text,
  workflow_launch_attempted_at timestamptz,
  client_idempotency_key text,
  final_output text,
  final_external_url text,
  cancel_requested_at timestamptz,
  cancellation_result text,
  failure_code text,
  failure_message text,
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL,
  repository_context_json json NOT NULL,
  repository_id bigint GENERATED ALWAYS AS ((repository_context_json->>'repositoryId')::bigint) STORED NOT NULL,
  execution_plan_json json NOT NULL,
  semantic_workflow_snapshot_json json NOT NULL,
  composition_snapshot_json json,
  orchestration_diagnostics_json json,
  managed_code_repository_contexts_json json,
  mcp_tool_snapshots_json json,
  security_profile_snapshots_json json,
  advisor_context_json json,
  UNIQUE (repository_id, client_idempotency_key)
);
CREATE INDEX workflow_runs_repository_created ON workflow_runs (repository_id, created_at DESC, id DESC);
CREATE INDEX workflow_runs_active ON workflow_runs (created_at, id)
  WHERE status IN ('queued','running','waiting_approval','cancelling');

CREATE TABLE workflow_step_attempts (
  run_id text NOT NULL REFERENCES workflow_runs ON DELETE CASCADE,
  step_id text NOT NULL,
  ordinal bigint GENERATED ALWAYS AS IDENTITY,
  iteration integer NOT NULL CHECK (iteration > 0),
  attempt integer NOT NULL CHECK (attempt > 0),
  agent_id text NOT NULL,
  connection_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','starting','waiting_provider','succeeded','failed','cancelled')),
  input_text text,
  output_text text,
  output_external_url text,
  provider_task_id text,
  provider_state text,
  provider_poll_count integer NOT NULL DEFAULT 0,
  next_poll_delay_ms integer,
  started_at timestamptz,
  completed_at timestamptz,
  failure_category text,
  safe_failure_message text,
  retryable smallint CHECK (retryable IN (0,1)),
  provider_task_url text,
  provider_client_request_id text,
  provider_request_id text,
  provider_http_status integer,
  provider_elapsed_ms integer,
  provider_processing_ms integer,
  provider_transport_outcome text CHECK (provider_transport_outcome IN ('response_received','timeout','network_error')),
  provider_transport_reason text CHECK (provider_transport_reason IN ('cross_request_io','invalid_request_context','network_connection_lost','aborted','fetch_type_error','unknown')),
  provider_runtime_error_name text CHECK (provider_runtime_error_name IN ('TypeError','AbortError','Error')),
  graph_activation_id text,
  conversation_source_run_id text,
  conversation_source_step_id text,
  conversation_source_activation_id text,
  conversation_source_iteration integer,
  conversation_source_attempt integer,
  PRIMARY KEY (run_id, step_id, iteration, attempt)
);
CREATE UNIQUE INDEX workflow_attempt_graph_activation ON workflow_step_attempts
  (run_id, step_id, graph_activation_id, attempt) WHERE graph_activation_id IS NOT NULL;

CREATE TABLE langgraph_checkpoints (
  run_id text NOT NULL REFERENCES workflow_runs ON DELETE CASCADE,
  checkpoint_namespace text NOT NULL,
  checkpoint_id text NOT NULL,
  parent_checkpoint_id text,
  checkpoint_json json NOT NULL,
  metadata_json json NOT NULL,
  config_json json NOT NULL,
  content_sha256 text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (run_id, checkpoint_namespace, checkpoint_id)
);
CREATE INDEX langgraph_checkpoints_thread_order ON langgraph_checkpoints
  (run_id, checkpoint_namespace, created_at DESC, checkpoint_id DESC);

CREATE TABLE langgraph_checkpoint_writes (
  run_id text NOT NULL REFERENCES workflow_runs ON DELETE CASCADE,
  checkpoint_namespace text NOT NULL,
  checkpoint_id text NOT NULL,
  task_id text NOT NULL,
  write_index integer NOT NULL,
  channel text NOT NULL,
  value_json json NOT NULL,
  content_sha256 text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (run_id, checkpoint_namespace, checkpoint_id, task_id, write_index)
);

CREATE TABLE langgraph_checkpoint_write_task_paths (
  run_id text NOT NULL REFERENCES workflow_runs ON DELETE CASCADE,
  checkpoint_namespace text NOT NULL,
  checkpoint_id text NOT NULL,
  task_id text NOT NULL,
  task_path text NOT NULL,
  PRIMARY KEY (run_id, checkpoint_namespace, checkpoint_id, task_id)
);

CREATE TABLE workflow_approvals (
  request_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES workflow_runs ON DELETE CASCADE,
  workflow_generation integer NOT NULL,
  node_id text NOT NULL,
  activation_id text NOT NULL,
  interrupt_id text NOT NULL,
  message text NOT NULL,
  review_text text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','approved')),
  requested_at timestamptz NOT NULL,
  approved_at timestamptz,
  consumed_at timestamptz,
  UNIQUE (run_id, workflow_generation, activation_id)
);
CREATE UNIQUE INDEX workflow_approvals_active ON workflow_approvals (run_id, workflow_generation)
  WHERE consumed_at IS NULL;

CREATE TABLE workflow_managed_pull_requests (
  run_id text NOT NULL REFERENCES workflow_runs ON DELETE CASCADE,
  step_id text NOT NULL,
  runner_job_id text NOT NULL,
  repository_task_id text NOT NULL,
  repository_id bigint NOT NULL,
  installation_id bigint NOT NULL,
  owner text NOT NULL,
  repository text NOT NULL,
  base_branch text NOT NULL,
  head_branch text NOT NULL,
  commit_sha text NOT NULL,
  pull_request_number integer NOT NULL,
  pull_request_url text NOT NULL,
  draft smallint NOT NULL CHECK (draft IN (0,1)),
  publication_created smallint NOT NULL CHECK (publication_created IN (0,1)),
  state text NOT NULL CHECK (state IN ('open','closed')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (run_id, step_id)
);

CREATE TABLE provider_credential_vault (
  secret_id text PRIMARY KEY,
  repository_id bigint NOT NULL CHECK (repository_id > 0),
  encrypted_credential text NOT NULL,
  credential_iv text NOT NULL,
  encryption_version integer NOT NULL CHECK (encryption_version > 0),
  master_key_version integer NOT NULL CHECK (master_key_version > 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repository_id, secret_id)
);

CREATE TABLE mcp_server_credentials (
  repository_id bigint NOT NULL,
  server_id text NOT NULL,
  binding_id text NOT NULL,
  trust_target text NOT NULL,
  secret_id text NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (repository_id, binding_id),
  UNIQUE (repository_id, server_id),
  FOREIGN KEY (repository_id, secret_id) REFERENCES provider_credential_vault (repository_id, secret_id) ON DELETE CASCADE
);

CREATE TABLE security_profile_credentials (
  repository_id bigint NOT NULL,
  security_profile_id text NOT NULL,
  binding_id text NOT NULL,
  trust_target text NOT NULL,
  secret_id text NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (repository_id, binding_id),
  UNIQUE (repository_id, security_profile_id),
  FOREIGN KEY (repository_id, secret_id) REFERENCES provider_credential_vault (repository_id, secret_id) ON DELETE CASCADE
);

CREATE TABLE work_iq_oauth_states (
  state_hash text PRIMARY KEY,
  connection_key text NOT NULL,
  repository_revision text NOT NULL,
  tenant_id text NOT NULL,
  client_id text NOT NULL,
  session_hash text NOT NULL,
  verifier_secret_ref text NOT NULL REFERENCES provider_credential_vault (secret_id) ON DELETE CASCADE,
  expires_at bigint NOT NULL,
  consumed_at bigint
);
CREATE INDEX work_iq_oauth_states_expiry ON work_iq_oauth_states (expires_at);

CREATE TABLE workflow_codex_environments (
  repository_id bigint NOT NULL CHECK (repository_id > 0),
  environment_key text NOT NULL,
  display_name text NOT NULL,
  external_environment_id text NOT NULL,
  enabled smallint NOT NULL CHECK (enabled IN (0,1)),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (repository_id, environment_key)
);

CREATE TABLE codex_environment_mutations (
  repository_id bigint NOT NULL,
  idempotency_key text NOT NULL,
  request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repository_id, idempotency_key)
);

CREATE TABLE agent_continuations (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES workflow_runs ON DELETE CASCADE,
  generation integer NOT NULL,
  node_id text NOT NULL,
  activation_id text NOT NULL,
  iteration integer NOT NULL,
  attempt integer NOT NULL,
  version integer NOT NULL DEFAULT 1,
  revision integer NOT NULL DEFAULT 0,
  state text NOT NULL CHECK (state IN ('ready','model_running','tools','waiting','reconciliation','completed','failed','cancelled')),
  provider text NOT NULL,
  model text NOT NULL,
  conversation_json json NOT NULL,
  model_turns integer NOT NULL DEFAULT 0,
  tool_proposals integer NOT NULL DEFAULT 0,
  tool_executions integer NOT NULL DEFAULT 0,
  tool_result_bytes integer NOT NULL DEFAULT 0,
  tool_result_limit integer NOT NULL DEFAULT 128000,
  tokens_used integer NOT NULL DEFAULT 0,
  active_ms bigint NOT NULL DEFAULT 0,
  suspended_ms bigint NOT NULL DEFAULT 0,
  waiting_started_at bigint,
  operation_started_at bigint,
  response_token text,
  updated_at bigint NOT NULL,
  failure_json json,
  UNIQUE (run_id, generation, node_id, activation_id, iteration, attempt),
  FOREIGN KEY (run_id, node_id, iteration, attempt)
    REFERENCES workflow_step_attempts (run_id, step_id, iteration, attempt) ON DELETE CASCADE
);
CREATE INDEX agent_waiting_runs ON agent_continuations (run_id, state);
CREATE INDEX agent_continuation_attempt_failure ON agent_continuations
  (run_id, node_id, activation_id, iteration, attempt, generation) WHERE failure_json IS NOT NULL;

CREATE TABLE agent_tool_invocations (
  id text PRIMARY KEY,
  continuation_id text NOT NULL REFERENCES agent_continuations ON DELETE CASCADE,
  turn integer NOT NULL,
  ordinal integer NOT NULL,
  provider_call_id text NOT NULL,
  tool_key text NOT NULL,
  alias text NOT NULL,
  frozen_json json NOT NULL,
  arguments_json json NOT NULL,
  target text NOT NULL,
  fingerprint text NOT NULL,
  state text NOT NULL CHECK (state IN ('proposed','validated','waiting','eligible','admitted','completed','denied','unknown','cancelled')),
  revision integer NOT NULL DEFAULT 0,
  security_json json,
  result_json json,
  result_bytes integer NOT NULL DEFAULT 0,
  completion_token text,
  admission_id text,
  admitted_at bigint,
  execution_deadline_at bigint,
  completed_at bigint,
  created_at bigint NOT NULL,
  UNIQUE (continuation_id, turn, ordinal),
  UNIQUE (continuation_id, turn, provider_call_id)
);

CREATE TABLE agent_tool_approvals (
  id text PRIMARY KEY,
  invocation_id text NOT NULL UNIQUE REFERENCES agent_tool_invocations ON DELETE CASCADE,
  continuation_revision integer NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','approved','rejected','expired','cancelled')),
  reviewers_json json NOT NULL,
  expires_at bigint NOT NULL,
  decided_at bigint,
  decided_by text,
  decision_id text UNIQUE,
  created_at bigint NOT NULL
);

CREATE TABLE agent_execution_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  continuation_id text NOT NULL REFERENCES agent_continuations ON DELETE CASCADE,
  invocation_id text REFERENCES agent_tool_invocations ON DELETE CASCADE,
  kind text NOT NULL,
  actor text NOT NULL,
  evidence_json json NOT NULL,
  created_at bigint NOT NULL
);
CREATE INDEX agent_execution_events_continuation ON agent_execution_events (continuation_id, id);

CREATE TABLE agent_reconciliation_decisions (
  id text PRIMARY KEY,
  invocation_id text NOT NULL REFERENCES agent_tool_invocations ON DELETE CASCADE,
  actor text NOT NULL,
  admission_id text NOT NULL,
  write_token text NOT NULL UNIQUE,
  decision text NOT NULL CHECK (decision IN ('success','not_executed','unresolved','terminate')),
  basis text NOT NULL,
  result_json json,
  created_at bigint NOT NULL
);

CREATE TABLE mcp_policy_attestations (
  id text PRIMARY KEY,
  repository_id bigint NOT NULL,
  server_id text NOT NULL,
  scope_json json NOT NULL,
  policies_digest text NOT NULL,
  tool_digests_json json NOT NULL,
  administrator smallint NOT NULL CHECK (administrator IN (0,1)),
  actor text NOT NULL,
  created_at bigint NOT NULL,
  UNIQUE (repository_id, server_id, id)
);

CREATE TABLE mcp_policy_heads (
  repository_id bigint NOT NULL,
  server_id text NOT NULL,
  revision integer NOT NULL DEFAULT 0,
  state text NOT NULL CHECK (state IN ('ready','updating','blocked')),
  authority_id text,
  mutation_id text,
  PRIMARY KEY (repository_id, server_id),
  FOREIGN KEY (repository_id, server_id, authority_id) REFERENCES mcp_policy_attestations (repository_id, server_id, id)
);

CREATE TABLE management_request_nonces (
  nonce text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX management_request_nonces_expiry ON management_request_nonces (expires_at);

CREATE TABLE advisor_settings (
  repository_id bigint PRIMARY KEY,
  settings_json json NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0)
);

CREATE TABLE advisor_knowledge_proposals (
  id text PRIMARY KEY,
  repository_scope text NOT NULL,
  owner_id bigint NOT NULL,
  actor text NOT NULL,
  document_json json NOT NULL,
  expected_sha text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  state text NOT NULL CHECK (state IN ('draft','reviewed','publishing','published','conflict','uncertain')),
  review_digest text,
  review_session text,
  review_expires_at bigint,
  publication_json json,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX advisor_knowledge_proposals_scope ON advisor_knowledge_proposals (repository_scope, owner_id, updated_at);
