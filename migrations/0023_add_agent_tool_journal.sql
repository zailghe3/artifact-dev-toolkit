-- Deploy with the new Worker and Runtime after draining synchronous tool runs.
CREATE TABLE agent_continuations (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
 generation INTEGER NOT NULL, node_id TEXT NOT NULL, activation_id TEXT NOT NULL,
 iteration INTEGER NOT NULL, attempt INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 revision INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL CHECK(state IN ('ready','model_running','tools','waiting','reconciliation','completed','failed','cancelled')),
 provider TEXT NOT NULL, model TEXT NOT NULL, conversation_json TEXT NOT NULL,
 model_turns INTEGER NOT NULL DEFAULT 0, tool_proposals INTEGER NOT NULL DEFAULT 0,
 tool_executions INTEGER NOT NULL DEFAULT 0, tool_result_bytes INTEGER NOT NULL DEFAULT 0, tool_result_limit INTEGER NOT NULL DEFAULT 128000, tokens_used INTEGER NOT NULL DEFAULT 0, active_ms INTEGER NOT NULL DEFAULT 0,
 suspended_ms INTEGER NOT NULL DEFAULT 0, waiting_started_at INTEGER,
 operation_started_at INTEGER, response_token TEXT, updated_at INTEGER NOT NULL,
 UNIQUE(run_id,generation,node_id,activation_id,iteration,attempt)
);
CREATE TABLE agent_tool_invocations (
 id TEXT PRIMARY KEY, continuation_id TEXT NOT NULL REFERENCES agent_continuations(id) ON DELETE CASCADE,
 turn INTEGER NOT NULL, ordinal INTEGER NOT NULL, provider_call_id TEXT NOT NULL,
 tool_key TEXT NOT NULL, alias TEXT NOT NULL, frozen_json TEXT NOT NULL, arguments_json TEXT NOT NULL,
 target TEXT NOT NULL, fingerprint TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('proposed','validated','waiting','eligible','admitted','completed','denied','unknown','cancelled')),
 revision INTEGER NOT NULL DEFAULT 0, security_json TEXT, result_json TEXT, result_bytes INTEGER NOT NULL DEFAULT 0, completion_token TEXT, admission_id TEXT, admitted_at INTEGER, execution_deadline_at INTEGER, completed_at INTEGER,
 created_at INTEGER NOT NULL, UNIQUE(continuation_id,turn,ordinal), UNIQUE(continuation_id,turn,provider_call_id)
);
CREATE TABLE agent_tool_approvals (
 id TEXT PRIMARY KEY, invocation_id TEXT NOT NULL REFERENCES agent_tool_invocations(id) ON DELETE CASCADE,
 continuation_revision INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','expired','cancelled')),
 reviewers_json TEXT NOT NULL, expires_at INTEGER NOT NULL, decided_at INTEGER, decided_by TEXT, decision_id TEXT UNIQUE,
 created_at INTEGER NOT NULL, UNIQUE(invocation_id)
);
CREATE TABLE agent_execution_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, continuation_id TEXT NOT NULL REFERENCES agent_continuations(id) ON DELETE CASCADE,
 invocation_id TEXT, kind TEXT NOT NULL, actor TEXT NOT NULL, evidence_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX agent_waiting_runs ON agent_continuations(run_id,state);
CREATE TABLE agent_reconciliation_decisions (
 id TEXT PRIMARY KEY, invocation_id TEXT NOT NULL REFERENCES agent_tool_invocations(id), actor TEXT NOT NULL,
 admission_id TEXT NOT NULL, write_token TEXT NOT NULL UNIQUE, decision TEXT NOT NULL CHECK(decision IN ('success','not_executed','unresolved','terminate')),
 basis TEXT NOT NULL, result_json TEXT, created_at INTEGER NOT NULL
);
