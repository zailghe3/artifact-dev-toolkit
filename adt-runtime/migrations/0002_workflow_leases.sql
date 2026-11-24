ALTER TABLE workflow_runs ADD COLUMN execution_fence bigint NOT NULL DEFAULT 0;
ALTER TABLE workflow_runs ADD COLUMN execution_lease_until timestamptz;
ALTER TABLE workflow_runs ADD COLUMN execution_scheduled_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE workflow_runs ADD COLUMN execution_failures integer NOT NULL DEFAULT 0;
CREATE INDEX workflow_execution_schedule ON workflow_runs (execution_scheduled_at, id)
  WHERE status IN ('queued','running','waiting_approval','cancelling');
