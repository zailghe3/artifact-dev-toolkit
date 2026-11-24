import type { Pool, PoolClient } from "pg";

export type WorkflowLease = { id: string; generation: number; fence: string; failures: number };

const LEASE_MS = 40_000;
export const WORKFLOW_HEARTBEAT_MS = 10_000;

export class WorkflowLeaseLost extends Error {
  constructor() { super("workflow_lease_lost"); }
}

export function workflowLeases(pool: Pool) {
  return {
    async claim(): Promise<WorkflowLease | undefined> {
      const result = await pool.query<WorkflowLease>(`WITH due AS (
        SELECT id FROM workflow_runs
        WHERE status IN ('queued','running','waiting_approval','cancelling')
          AND execution_scheduled_at <= clock_timestamp()
          AND (execution_lease_until IS NULL OR execution_lease_until <= clock_timestamp())
        ORDER BY execution_scheduled_at, id
        FOR UPDATE SKIP LOCKED LIMIT 1
      )
      UPDATE workflow_runs AS r SET execution_fence = execution_fence + 1,
        execution_lease_until = clock_timestamp() + $1::integer * interval '1 millisecond'
      FROM due WHERE r.id = due.id
      RETURNING r.id, r.workflow_generation AS generation, r.execution_fence::text AS fence,
        r.execution_failures AS failures`, [LEASE_MS]);
      return result.rows[0];
    },
    async guard(client: PoolClient, lease: WorkflowLease) {
      const row = await client.query(`SELECT 1 FROM workflow_runs
        WHERE id=$1 AND workflow_generation=$2 AND execution_fence=$3
          AND execution_lease_until > clock_timestamp() FOR UPDATE`, [lease.id, lease.generation, lease.fence]);
      if (row.rowCount !== 1) throw new WorkflowLeaseLost();
    },
    async renew(lease: WorkflowLease) {
      const result = await pool.query(`UPDATE workflow_runs SET
        execution_lease_until = clock_timestamp() + $4::integer * interval '1 millisecond'
        WHERE id=$1 AND workflow_generation=$2 AND execution_fence=$3
          AND execution_lease_until > clock_timestamp()`, [lease.id, lease.generation, lease.fence, LEASE_MS]);
      if (result.rowCount !== 1) throw new WorkflowLeaseLost();
    },
    async release(lease: WorkflowLease, delayMs: number, failures = 0) {
      await pool.query(`UPDATE workflow_runs SET execution_lease_until=NULL,
        execution_scheduled_at=clock_timestamp() + $4::integer * interval '1 millisecond', execution_failures=$5
        WHERE id=$1 AND workflow_generation=$2 AND execution_fence=$3
          AND execution_lease_until > clock_timestamp()`, [lease.id, lease.generation, lease.fence, delayMs, failures]);
    },
    async wake(id: string) {
      await pool.query("UPDATE workflow_runs SET execution_scheduled_at=clock_timestamp() WHERE id=$1", [id]);
    },
  };
}
