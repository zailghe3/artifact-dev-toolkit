import { types, type Pool, type PoolClient, type QueryResultRow } from "pg";
import { inTransaction } from "./postgres.js";

type StatementResult<T> = { results: T[]; meta: { changes: number } };
const postgresTypes = {
  getTypeParser(oid: number) {
    if (oid === types.builtins.JSON || oid === types.builtins.JSONB) return (value: string) => value;
    if (oid === types.builtins.INT8 || oid === types.builtins.NUMERIC) return (value: string) => Number(value);
    if (oid === types.builtins.TIMESTAMPTZ) return (value: string) => new Date(value).toISOString();
    return types.getTypeParser(oid);
  },
};

/** Parameters are positional in the shared repositories. SQL comes from application code. */
function parameterized(sql: string) {
  let index = 0;
  let result = sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/g, token => token === "?" ? `$${++index}` : token);
  if (/^INSERT OR IGNORE INTO /i.test(result)) {
    result = result.replace(/^INSERT OR IGNORE INTO /i, "INSERT INTO ") + " ON CONFLICT DO NOTHING";
  }
  return { text: result, count: index };
}

class Statement {
  constructor(private readonly database: PostgresWorkflowDatabase, private readonly sql: string, private readonly values: unknown[] = []) {}

  bind(...values: unknown[]) {
    return new Statement(this.database, this.sql, values);
  }

  async execute<T>(connection: Pool | PoolClient): Promise<StatementResult<T>> {
    const { text, count } = parameterized(this.sql);
    if (count !== this.values.length) throw new Error("postgres_parameter_count_mismatch");
    const result = await connection.query<QueryResultRow>({ text, values: this.values, types: postgresTypes });
    return { results: result.rows as T[], meta: { changes: result.rowCount ?? 0 } };
  }

  all<T>() {
    return this.database.execute<T>(this, this.sql);
  }

  async first<T>(column?: string) {
    const row = (await this.all<T>()).results[0];
    if (row === undefined) return null;
    return column === undefined ? row : (row as Record<string, T>)[column] ?? null;
  }

  run<T>() {
    return this.all<T>();
  }
}

// Shared multi-statement state transitions rely on a consistent view of the
// preceding guarded mutation. Serialize writes across statements in each
// short transaction. Provider/tool calls never run inside these transactions.
const OPERATIONAL_WRITE_LOCK = 1_104_528_374;

export class PostgresWorkflowDatabase {
  readonly dialect = "postgres" as const;

  constructor(private readonly pool: Pool, private readonly checkFence?: (client: PoolClient) => Promise<void>, private readonly connection?: PoolClient) {}

  prepare(sql: string) {
    return new Statement(this, sql);
  }

  async execute<T>(statement: Statement, sql: string) {
    if (this.connection) return statement.execute<T>(this.connection);
    if (/^\s*SELECT\b/i.test(sql)) return statement.execute<T>(this.pool);
    return inTransaction(this.pool, async client => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [OPERATIONAL_WRITE_LOCK]);
      await this.checkFence?.(client);
      return statement.execute<T>(client);
    });
  }

  async transaction<T>(work: (database: PostgresWorkflowDatabase) => Promise<T>): Promise<T> {
    if (this.connection) return work(this);
    return inTransaction(this.pool, async client => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [OPERATIONAL_WRITE_LOCK]);
      await this.checkFence?.(client);
      return work(new PostgresWorkflowDatabase(this.pool, undefined, client));
    });
  }

  async batch<T>(statements: unknown[]) {
    return this.transaction(async database => {
      const results: StatementResult<T>[] = [];
      for (const statement of statements) {
        if (!(statement instanceof Statement)) throw new Error("postgres_invalid_statement");
        results.push(await statement.execute<T>(database.connection!));
      }
      return results;
    });
  }
}
