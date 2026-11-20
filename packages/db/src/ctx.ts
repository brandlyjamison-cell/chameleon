import pg from "pg";

export type Role = "owner" | "member";

export interface Ctx {
  readonly orgId: string;
  readonly userId: string | null;
  readonly role: Role;
  /** Set when the request is scoped to one service (vault, edge). */
  readonly serviceId?: string;
}

export interface Db {
  readonly pool: pg.Pool;
}

export function createDb(connectionString: string, max = 4): Db {
  return { pool: new pg.Pool({ connectionString, max }) };
}

/**
 * Runs `fn` in one transaction with the tenant GUC set. RLS does the rest
 * (INV-DATA-01); the GUC is set with `is_local` so it dies with the transaction.
 */
export async function withTenant<T>(
  db: Db,
  ctx: Ctx,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.org_id', $1, true)", [ctx.orgId]);
    if (ctx.serviceId !== undefined) {
      await client.query("select set_config('app.service_id', $1, true)", [
        ctx.serviceId,
      ]);
    }
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Read-only variant without a transaction wrapper, for lists. */
export async function asTenant<T>(
  db: Db,
  ctx: Ctx,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return withTenant(db, ctx, fn);
}

export class CapError extends Error {
  constructor(readonly slot: "link" | "domain") {
    super(`${slot}_slots_exhausted`);
  }
}

export class NotFoundError extends Error {
  constructor() {
    super("not_found");
  }
}

/** A foreign id is a 404, never a 403 (INV-DATA-07). */
export function orNotFound<T>(row: T | undefined | null): T {
  if (row === null || row === undefined) throw new NotFoundError();
  return row;
}
