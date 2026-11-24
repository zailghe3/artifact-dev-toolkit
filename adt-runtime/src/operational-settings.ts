import { createHash } from "node:crypto";
import { AUTH_WINDOW_MS } from "./protocol.js";
import { inTransaction } from "./postgres.js";
import type { Pool } from "pg";
import {
  advisorSettingsRecordSchema, codexEnvironmentInputSchema,
  type AdvisorSettings, type OperationalSettingsCommand,
} from "./operational-settings-contract.js";

export class OperationalSettingsConflict extends Error {}

export function recordManagementNonce(pool: Pool, nonce: string, timestamp: number) {
  return inTransaction(pool, async client => {
    await client.query("DELETE FROM management_request_nonces WHERE expires_at < clock_timestamp()");
    const claimed = await client.query(`INSERT INTO management_request_nonces (nonce, expires_at)
      VALUES ($1, $2) ON CONFLICT DO NOTHING`, [nonce, new Date(timestamp + AUTH_WINDOW_MS)]);
    return claimed.rowCount === 1;
  });
}

export function operationalSettings(pool: Pool) {
  return async (command: OperationalSettingsCommand) => {
    const { repositoryId } = command;
    switch (command.operation) {
      case "advisor.get": {
        const result = await pool.query<{ settings: AdvisorSettings; revision: number }>(
          "SELECT settings_json AS settings, revision FROM advisor_settings WHERE repository_id = $1", [repositoryId],
        );
        return advisorSettingsRecordSchema.parse(result.rows[0] ?? {
          settings: { workflowId: null, override: null }, revision: 0,
        });
      }
      case "advisor.save": {
        const { settings, revision } = command;
        // Replays from a lost response may return the already committed result.
        // An intervening update with a different value is a revision conflict.
        const saved = revision === 0
          ? await pool.query(`INSERT INTO advisor_settings (repository_id, settings_json)
            VALUES ($1, $2) ON CONFLICT (repository_id) DO NOTHING RETURNING revision`, [repositoryId, settings])
          : await pool.query(`UPDATE advisor_settings SET settings_json = $2, revision = revision + 1
            WHERE repository_id = $1 AND revision = $3 RETURNING revision`, [repositoryId, settings, revision]);
        if (saved.rowCount !== 1) {
          const replay = await pool.query(`SELECT 1 FROM advisor_settings WHERE repository_id = $1
            AND settings_json::jsonb = $2::jsonb AND revision = $3`, [repositoryId, settings, revision + 1]);
          if (replay.rowCount !== 1) throw new OperationalSettingsConflict("advisor_settings_conflict");
        }
        return { settings, revision: revision + 1 };
      }
      case "codex.list": {
        const { rows } = await pool.query(`SELECT environment_key AS key, display_name AS name,
          external_environment_id AS "externalEnvironmentId", enabled = 1 AS enabled
          FROM workflow_codex_environments WHERE repository_id = $1 ORDER BY display_name, environment_key`, [repositoryId]);
        return codexEnvironmentInputSchema.array().parse(rows);
      }
      case "codex.save":
      case "codex.delete": {
        const bodyDigest = createHash("sha256").update(JSON.stringify(command)).digest("hex");
        return inTransaction(pool, async client => {
          const inserted = await client.query(`INSERT INTO codex_environment_mutations
            (repository_id, idempotency_key, request_digest) VALUES ($1, $2, $3)
            ON CONFLICT (repository_id, idempotency_key) DO NOTHING`, [repositoryId, command.idempotencyKey, bodyDigest]);
          if (inserted.rowCount !== 1) {
            const recorded = await client.query<{request_digest:string}>(`SELECT request_digest
              FROM codex_environment_mutations WHERE repository_id = $1 AND idempotency_key = $2`,
              [repositoryId, command.idempotencyKey]);
            if (recorded.rows[0]?.request_digest !== bodyDigest) throw new OperationalSettingsConflict("runtime_settings_conflict");
            return command.operation === "codex.save" ? command.environment : null;
          }
          if (command.operation === "codex.delete") {
            await client.query("DELETE FROM workflow_codex_environments WHERE repository_id = $1 AND environment_key = $2",
              [repositoryId, command.key]);
            return null;
          }
          const { key, name, externalEnvironmentId, enabled } = command.environment;
          await client.query(`INSERT INTO workflow_codex_environments
            (repository_id, environment_key, display_name, external_environment_id, enabled, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, now(), now()) ON CONFLICT (repository_id, environment_key) DO UPDATE SET
            display_name = excluded.display_name, external_environment_id = excluded.external_environment_id,
            enabled = excluded.enabled, updated_at = now()`,
            [repositoryId, key, name, externalEnvironmentId, enabled ? 1 : 0]);
          return command.environment;
        });
      }
    }
  };
}
