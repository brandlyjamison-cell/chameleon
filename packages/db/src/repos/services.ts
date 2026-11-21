import type pg from "pg";
import { CapError, orNotFound, type Ctx } from "../ctx";

export interface ServiceRow {
  id: string;
  org_id: string;
  service_type_id: number;
  tier_id: number;
  status: string;
  expires_at: Date | null;
  gate_mode: string;
  link_slots_used: number;
  domain_slots_used: number;
}

const COLUMNS = `id, org_id, service_type_id, tier_id, status, expires_at, gate_mode,
  link_slots_used, domain_slots_used`;

export async function list(c: pg.PoolClient, _ctx: Ctx): Promise<ServiceRow[]> {
  const { rows } = await c.query<ServiceRow>(
    `select ${COLUMNS} from services order by created_at desc`,
  );
  return rows;
}

export async function get(c: pg.PoolClient, _ctx: Ctx, id: string): Promise<ServiceRow> {
  const { rows } = await c.query<ServiceRow>(
    `select ${COLUMNS} from services where id = $1`,
    [id],
  );
  return orNotFound(rows[0]);
}

/** Locks the service row and returns its live caps. Every slot check uses this. */
export async function lockWithCaps(
  c: pg.PoolClient,
  serviceId: string,
): Promise<{
  status: string;
  activated_at: Date | null;
  link_cap: number;
  domain_cap: number;
  link_slots_used: number;
  domain_slots_used: number;
}> {
  const { rows } = await c.query(
    `select s.status, s.activated_at, t.link_cap, t.domain_cap,
            s.link_slots_used, s.domain_slots_used
     from services s join tiers t on t.id = s.tier_id
     where s.id = $1 for update of s`,
    [serviceId],
  );
  return orNotFound(rows[0]);
}

export function assertFree(slot: "link" | "domain", used: number, cap: number): void {
  if (used >= cap) throw new CapError(slot);
}

export async function create(
  c: pg.PoolClient,
  ctx: Ctx,
  input: { serviceTypeId: number; tierId: number },
): Promise<ServiceRow> {
  const { rows } = await c.query<ServiceRow>(
    `insert into services (org_id, service_type_id, tier_id, status)
     values ($1, $2, $3, 'provisioning') returning ${COLUMNS}`,
    [ctx.orgId, input.serviceTypeId, input.tierId],
  );
  return orNotFound(rows[0]);
}
