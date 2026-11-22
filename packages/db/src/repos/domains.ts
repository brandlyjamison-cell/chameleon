import type pg from "pg";
import { assertFree, lockWithCaps } from "./services";
import { NotFoundError, orNotFound, type Ctx } from "../ctx";

/** A verified root the org owns. One verification, many hostnames under it. */
export interface OrgDomainRow {
  id: string;
  org_id: string;
  root: string;
  status: string;
  verify_token: string;
  routing_state: string;
  review_needed: boolean;
  last_checked_at: Date | null;
  last_result: string | null;
  last_detail: string | null;
  hostname_count: number;
}

/** A single address under a root; this is what a service actually consumes. */
export interface HostnameRow {
  id: string;
  org_id: string;
  domain_id: string;
  service_id: string;
  fqdn: string;
  label: string;
  status: string;
  created_at: Date;
}

const DOMAIN_SELECT = `
  select d.id, d.org_id, d.root, d.status, d.verify_token, d.routing_state,
         d.review_needed, d.last_checked_at,
         (select result from domain_checks c where c.org_domain_id = d.id
           order by c.created_at desc limit 1) as last_result,
         (select detail from domain_checks c where c.org_domain_id = d.id
           order by c.created_at desc limit 1) as last_detail,
         (select count(*)::int from hostnames h
           where h.domain_id = d.id and h.deleted_at is null) as hostname_count
    from org_domains d`;

export async function addDomain(
  c: pg.PoolClient,
  ctx: Ctx,
  input: { root: string; verifyToken: string },
): Promise<OrgDomainRow> {
  const { rows } = await c.query<OrgDomainRow>(
    `insert into org_domains (org_id, root, verify_token)
     values ($1, $2, $3)
     returning id, org_id, root, status, verify_token, routing_state,
               review_needed, last_checked_at,
               null::text as last_result, null::text as last_detail,
               0 as hostname_count`,
    [ctx.orgId, input.root.toLowerCase(), input.verifyToken],
  );
  return orNotFound(rows[0]);
}

export async function listDomains(c: pg.PoolClient, _ctx: Ctx): Promise<OrgDomainRow[]> {
  const { rows } = await c.query<OrgDomainRow>(
    `${DOMAIN_SELECT} where d.deleted_at is null order by d.created_at desc`,
  );
  return rows;
}

export async function getDomain(
  c: pg.PoolClient,
  _ctx: Ctx,
  id: string,
): Promise<OrgDomainRow> {
  const { rows } = await c.query<OrgDomainRow>(`${DOMAIN_SELECT} where d.id = $1`, [id]);
  return orNotFound(rows[0]);
}

export async function softDeleteDomain(c: pg.PoolClient, id: string): Promise<void> {
  await c.query(
    `update org_domains
        set deleted_at = now(), tombstoned_at = now(), status = 'failed'
      where id = $1 and deleted_at is null`,
    [id],
  );
  await c.query(
    `update hostnames set deleted_at = now(), tombstoned_at = now(), status = 'failed'
      where domain_id = $1 and deleted_at is null`,
    [id],
  );
}

export async function addHostname(
  c: pg.PoolClient,
  ctx: Ctx,
  input: { serviceId: string; domainId: string; label: string; fqdn: string },
): Promise<HostnameRow> {
  const caps = await lockWithCaps(c, input.serviceId);
  assertFree("hostname", caps.hostname_slots_used, caps.hostname_cap);

  const { rows } = await c.query<HostnameRow>(
    `insert into hostnames (org_id, domain_id, service_id, label, fqdn, status)
     values ($1, $2, $3, $4, $5, 'provisioning')
     returning id, org_id, domain_id, service_id, fqdn, label, status, created_at`,
    [ctx.orgId, input.domainId, input.serviceId, input.label, input.fqdn.toLowerCase()],
  );
  return orNotFound(rows[0]);
}

export async function listHostnames(
  c: pg.PoolClient,
  _ctx: Ctx,
  serviceId: string,
): Promise<HostnameRow[]> {
  const { rows } = await c.query<HostnameRow>(
    `select id, org_id, domain_id, service_id, fqdn, label, status, created_at
       from hostnames
      where service_id = $1 and deleted_at is null
      order by created_at`,
    [serviceId],
  );
  return rows;
}

export async function listHostnamesForDomain(
  c: pg.PoolClient,
  _ctx: Ctx,
  domainId: string,
): Promise<HostnameRow[]> {
  const { rows } = await c.query<HostnameRow>(
    `select id, org_id, domain_id, service_id, fqdn, label, status, created_at
       from hostnames
      where domain_id = $1 and deleted_at is null
      order by created_at`,
    [domainId],
  );
  return rows;
}

export async function getHostname(
  c: pg.PoolClient,
  _ctx: Ctx,
  id: string,
): Promise<HostnameRow> {
  const { rows } = await c.query<HostnameRow>(
    `select id, org_id, domain_id, service_id, fqdn, label, status, created_at
       from hostnames where id = $1`,
    [id],
  );
  return orNotFound(rows[0]);
}

export async function softDeleteHostname(c: pg.PoolClient, id: string): Promise<void> {
  await c.query(
    `update hostnames set deleted_at = now(), tombstoned_at = now(), status = 'failed'
      where id = $1 and deleted_at is null`,
    [id],
  );
}

export interface VerifyRow extends OrgDomainRow {
  wildcard_cf_id: string | null;
  verified_at: Date | null;
}

export const TXT_PREFIX = "cameleon-verify=";

export async function beginVerify(
  c: pg.PoolClient,
  id: string,
  orgId: string,
): Promise<VerifyRow> {
  try {
    const { rows } = await c.query<VerifyRow>("select * from begin_verify($1, $2)", [
      id,
      orgId,
    ]);
    return orNotFound(rows[0]);
  } catch (error) {
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
    `insert into domain_checks (org_id, org_domain_id, result, detail)
     select org_id, id, $2, $3 from org_domains where id = $1`,
    [id, result, detail],
  );
  await c.query(`update org_domains set last_checked_at = now() where id = $1`, [id]);
}

export async function markProven(
  c: pg.PoolClient,
  id: string,
  wildcardCfId: string | null,
): Promise<void> {
  await c.query(
    `update org_domains
        set verified_at = coalesce(verified_at, now()), verified_by = 'txt',
            wildcard_cf_id = coalesce($2, wildcard_cf_id)
      where id = $1 and deleted_at is null`,
    [id, wildcardCfId],
  );
}

export async function failDomain(c: pg.PoolClient, id: string): Promise<void> {
  await c.query(
    `update org_domains set status = 'failed' where id = $1 and deleted_at is null`,
    [id],
  );
  await c.query(
    `update hostnames set status = 'failed'
      where domain_id = $1 and deleted_at is null and status <> 'paused'`,
    [id],
  );
}

/** Verified root that still needs routing before its hostnames can answer. */
export async function waitForRouting(c: pg.PoolClient, id: string): Promise<void> {
  await c.query(
    `update org_domains set status = 'routing_waiting', routing_state = 'waiting'
      where id = $1 and verified_at is not null and deleted_at is null`,
    [id],
  );
}

export async function markRouting(
  c: pg.PoolClient,
  id: string,
  wildcardCfId: string,
): Promise<void> {
  await c.query(
    `update org_domains
        set status = 'active', routing_state = 'active', wildcard_cf_id = $2
      where id = $1 and deleted_at is null`,
    [id, wildcardCfId],
  );
  await c.query(
    `update hostnames set status = 'waiting'
      where domain_id = $1 and deleted_at is null and status = 'provisioning'`,
    [id],
  );
}

export async function promote(c: pg.PoolClient, id: string): Promise<void> {
  await c.query(
    `update org_domains set status = 'active'
      where id = $1 and verified_at is not null and deleted_at is null`,
    [id],
  );
}

export async function expireStale(c: pg.PoolClient): Promise<number> {
  const { rows } = await c.query<{ n: number }>("select expire_stale_domains() as n");
  return rows[0]?.n ?? 0;
}

/** Only the job can look across tenants, so it uses the definer function. */
export async function dueForCheck(c: pg.PoolClient, limit = 25): Promise<VerifyRow[]> {
  const { rows } = await c.query<VerifyRow>("select * from due_domain_checks($1)", [
    limit,
  ]);
  return rows;
}
