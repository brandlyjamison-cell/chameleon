import type pg from "pg";
import { assertFree, lockWithCaps } from "./services";
import { orNotFound, type Ctx } from "../ctx";

export interface DomainRow {
  id: string;
  org_id: string;
  service_id: string;
  hostname: string;
  status: string;
  verify_token: string;
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
    `select id, org_id, service_id, hostname, status, verify_token
     from domains where service_id = $1 and deleted_at is null order by created_at`,
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
