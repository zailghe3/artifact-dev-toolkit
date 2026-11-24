-- Operator-only import after the D1 backup and verified PostgreSQL cutover.
-- Cloudflare's D1 import restores the original database if a statement fails.
-- The guard stops the import before the first drop if the inventory differs.
CREATE TABLE adt_d1_retirement_guard (
  matches_expected_schema INTEGER NOT NULL,
  CONSTRAINT unexpected_d1_schema CHECK (matches_expected_schema = 1)
);

WITH expected(type, name, owner) AS (
  VALUES
    ('table','auth_sessions','auth_sessions'),
    ('table','advisor_knowledge_proposals','advisor_knowledge_proposals'),
    ('table','advisor_settings','advisor_settings'),
    ('table','agent_continuations','agent_continuations'),
    ('table','agent_execution_events','agent_execution_events'),
    ('table','agent_reconciliation_decisions','agent_reconciliation_decisions'),
    ('table','agent_tool_approvals','agent_tool_approvals'),
    ('table','agent_tool_invocations','agent_tool_invocations'),
    ('table','langgraph_checkpoint_write_task_paths','langgraph_checkpoint_write_task_paths'),
    ('table','langgraph_checkpoint_writes','langgraph_checkpoint_writes'),
    ('table','langgraph_checkpoints','langgraph_checkpoints'),
    ('table','mcp_policy_attestations','mcp_policy_attestations'),
    ('table','mcp_policy_heads','mcp_policy_heads'),
    ('table','mcp_server_credentials','mcp_server_credentials'),
    ('table','provider_credential_vault','provider_credential_vault'),
    ('table','security_profile_credentials','security_profile_credentials'),
    ('table','work_iq_oauth_states','work_iq_oauth_states'),
    ('table','workflow_approvals','workflow_approvals'),
    ('table','workflow_codex_environments','workflow_codex_environments'),
    ('table','workflow_managed_pull_requests','workflow_managed_pull_requests'),
    ('table','workflow_provider_connections','workflow_provider_connections'),
    ('table','workflow_runs','workflow_runs'),
    ('table','workflow_step_attempts','workflow_step_attempts'),
    ('index','auth_sessions_authorization_idx','auth_sessions'),
    ('index','auth_sessions_expires_at_idx','auth_sessions'),
    ('index','advisor_knowledge_proposals_scope','advisor_knowledge_proposals'),
    ('index','agent_continuation_attempt_failure','agent_continuations'),
    ('index','agent_waiting_runs','agent_continuations'),
    ('index','langgraph_checkpoints_thread_order','langgraph_checkpoints'),
    ('index','work_iq_oauth_states_expiry_idx','work_iq_oauth_states'),
    ('index','workflow_approvals_active','workflow_approvals'),
    ('index','workflow_attempt_graph_activation','workflow_step_attempts'),
    ('index','workflow_attempts_order','workflow_step_attempts'),
    ('index','workflow_runs_nonterminal','workflow_runs'),
    ('index','workflow_runs_recent','workflow_runs'),
    ('index','workflow_runs_repository_created_idx','workflow_runs')
), live AS (
  SELECT type, name, tbl_name FROM sqlite_schema
  WHERE name NOT GLOB 'sqlite_*'
    AND tbl_name NOT IN ('_cf_KV','_cf_METADATA','d1_migrations','adt_d1_retirement_guard')
)
INSERT INTO adt_d1_retirement_guard VALUES (
  NOT EXISTS (SELECT * FROM expected EXCEPT SELECT * FROM live)
  AND NOT EXISTS (SELECT * FROM live EXCEPT SELECT * FROM expected)
);

-- Each drop also removes that table's explicit and generated indexes.
DROP TABLE agent_reconciliation_decisions;
DROP TABLE agent_tool_approvals;
DROP TABLE agent_execution_events;
DROP TABLE agent_tool_invocations;
DROP TABLE agent_continuations;
DROP TABLE langgraph_checkpoint_write_task_paths;
DROP TABLE langgraph_checkpoint_writes;
DROP TABLE langgraph_checkpoints;
DROP TABLE workflow_approvals;
DROP TABLE workflow_managed_pull_requests;
DROP TABLE workflow_step_attempts;
DROP TABLE workflow_runs;
DROP TABLE work_iq_oauth_states;
DROP TABLE mcp_policy_heads;
DROP TABLE mcp_policy_attestations;
DROP TABLE mcp_server_credentials;
DROP TABLE security_profile_credentials;
DROP TABLE provider_credential_vault;
DROP TABLE workflow_provider_connections;
DROP TABLE workflow_codex_environments;
DROP TABLE advisor_knowledge_proposals;
DROP TABLE advisor_settings;
DROP TABLE adt_d1_retirement_guard;
