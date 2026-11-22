import type pg from "pg";
import { assertFree, lockWithCaps } from "./services";
import { NotFoundError, orNotFound, type Ctx } from "../ctx";

export interface DomainRow {
  id: string;
  org_id: string;
  service_id: string;
  hostname: string;
  status: string;
  verify_token: string;
  last_checked_at: Date | null;
  last_result: string | null;
  last_detail: string | null;
}

export async function add(
  c: pg.PoolClient,
  _ctx: Ctx,
  input: { serviceId: string; hostname: string; verifyToken: string },
): Promise<DomainRow> {
  const caps = await lockWithCaps(c, input.serviceId);
  assertFree("domain", caps.domain_slots_used, caps.domain_cap);

  const { rows } = await c.query<DomainRow>(
    `insert into domains (org_id, service_id, hostname, verify_token)
     values ((select org_id from services where id = $1), $1, $2, $3)
     returning id, org_id, service_id, hostname, status, verify_token`,
    [input.serviceId, input.hostname.toLowerCase(), input.verifyToken],
  );
  return orNotFound(rows[0]);
}

export async function listForService(
  c: pg.PoolClient,
  _ctx: Ctx,
  serviceId: string,
): Promise<DomainRow[]> {
  const { rows } = await c.query<DomainRow>(
    `select d.id, d.org_id, d.service_id, d.hostname, d.status, d.verify_token,
            d.last_checked_at, c.result as last_result, c.detail as last_detail
       from domains d
       left join lateral (
         select result, detail from domain_checks
          where domain_id = d.id order by created_at desc limit 1
       ) c on true
      where d.service_id = $1 and d.deleted_at is null
      order by d.created_at`,
    [serviceId],
  );
  return rows;
}

export async function get(c: pg.PoolClient, _ctx: Ctx, id: string): Promise<DomainRow> {
  const { rows } = await c.query<DomainRow>(
    `select id, org_id, service_id, hostname, status, verify_token from domains where id = $1`,
    [id],
  );
  return orNotFound(rows[0]);
}

/**
 * Only the verify job may activate, and only with a verified timestamp
 * (INV-SEC-06).
 */
export async function activate(c: pg.PoolClient, id: string): Promise<void> {
  await c.query(
    `update domains
     set status = 'active', verified_at = coalesce(verified_at, now()), verified_by = coalesce(verified_by, 'txt')
     where id = $1 and verified_at is not null`,
    [id],
  );
}

export async function softDelete(c: pg.PoolClient, id: string): Promise<void> {
  await c.query(
    `update domains set deleted_at = now(), tombstoned_at = now(), status = 'failed'
     where id = $1 and deleted_at is null`,
    [id],
  );
}

export interface VerifyRow extends DomainRow {
  cf_hostname_id: string | null;
  verified_at: Date | null;
  last_checked_at: Date | null;
}

export const TXT_PREFIX = "cameleon-verify=";

export async function beginVerify(
  c: pg.PoolClient,
  id: string,
  orgId: string,
): Promise<VerifyRow> {
  // The definer function qualifies the row and restarts the clock on a failed
  // re-check (0020); active rows stay active through a daily re-check.
  try {
    const { rows } = await c.query<VerifyRow>("select * from begin_verify($1, $2)", [
      id,
      orgId,
    ]);
    return orNotFound(rows[0]);
  } catch (error) {
    // A definer exception is a plain pg error, not an HttpError.
    if ((error as { code?: string }).code === "P0002") throw new NotFoundError();
    throw error;
  }
}

export async function recordCheck(
  c: pg.PoolClient,
  id: string,
  result: "match" | "mismatch" | "error",
  detail: string | null,
): Promise<void> {
  await c.query(
    `insert into domain_checks (org_id, domain_id, result, detail)
     select org_id, id, $2, $3 from domains where id = $1`,
    [id, result, detail],
  );
  await c.query(`update domains set last_checked_at = now() where id = $1`, [id]);
}

/**
 * A proven TXT is not an active host: hold `verified_at` and the Cloudflare id,
 * and let a separate step promote once Cloudflare says the hostname is active.
 */
export async function markProven(
  c: pg.PoolClient,
  id: string,
  cfHostnameId: string | null,
): Promise<void> {
  await c.query(
    `update domains set verified_at = coalesce(verified_at, now()), verified_by = 'txt',
       cf_hostname_id = coalesce($2, cf_hostname_id)
     where id = $1 and deleted_at is null`,
    [id, cfHostnameId],
  );
}

/** A live host whose TXT disappeared: the edge must stop rendering it. */
export async function fail(c: pg.PoolClient, id: string): Promise<void> {
  await c.query(
    `update domains set status = 'failed' where id = $1 and deleted_at is null`,
    [id],
  );
}

export async function promote(c: pg.PoolClient, id: string): Promise<void> {
  await c.query(
    `update domains set status = 'active' where id = $1 and verified_at is not null
       and deleted_at is null`,
    [id],
  );
}

export async function expireStale(c: pg.PoolClient): Promise<number> {
  const { rows } = await c.query<{ n: number }>("select expire_stale_domains() as n");
  return rows[0]?.n ?? 0;
}

/**
 * Cross-tenant due list; the caller is a bare connection, not a tenant, so this
 * one goes through the SECURITY DEFINER function (0007).
 */
export async function dueForCheck(c: pg.PoolClient, limit = 25): Promise<VerifyRow[]> {
  const { rows } = await c.query<VerifyRow>("select * from due_domain_checks($1)", [
    limit,
  ]);
  return rows;
}
