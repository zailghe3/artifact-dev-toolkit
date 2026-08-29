CREATE TABLE workflow_approvals (
 request_id TEXT PRIMARY KEY,
 run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
 workflow_generation INTEGER NOT NULL,
 node_id TEXT NOT NULL,
 activation_id TEXT NOT NULL,
 interrupt_id TEXT NOT NULL,
 message TEXT NOT NULL,
 review_text TEXT NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('pending','approved')),
 requested_at TEXT NOT NULL,
 approved_at TEXT,
 UNIQUE (run_id, workflow_generation, activation_id)
);
CREATE INDEX workflow_approvals_pending ON workflow_approvals(run_id, status);
