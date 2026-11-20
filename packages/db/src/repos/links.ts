import type pg from "pg";
import { assertFree, lockWithCaps } from "./services.js";
import { orNotFound, type Ctx } from "../ctx.js";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function slug(length = 5): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

export interface LinkRow {
  id: string;
  org_id: string;
  service_id: string;
  domain_id: string;
  slug: string;
  pinned_brand_id: string | null;
  status: string;
}

/**
 * Mints under the service row lock, so 30 concurrent calls on a cap of 20 leave
 * exactly 20 (INV-DATA-04/05).
 */
export async function mint(
  c: pg.PoolClient,
  _ctx: Ctx,
  input: { serviceId: string; domainId: string; pin?: string | null },
): Promise<LinkRow> {
  const caps = await lockWithCaps(c, input.serviceId);
  assertFree("link", caps.link_slots_used, caps.link_cap);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { rows } = await c.query<LinkRow>(
        `insert into links (org_id, service_id, domain_id, slug, pinned_brand_id)
         values ((select org_id from services where id = $1), $1, $2, $3, $4)
         returning id, org_id, service_id, domain_id, slug, pinned_brand_id, status`,
        [input.serviceId, input.domainId, slug(), input.pin ?? null],
      );
      return orNotFound(rows[0]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "23505" || attempt === 2) throw error;
    }
  }
  throw new Error("unreachable");
}

export async function listForService(
  c: pg.PoolClient,
  _ctx: Ctx,
  serviceId: string,
): Promise<LinkRow[]> {
  const { rows } = await c.query<LinkRow>(
    `select id, org_id, service_id, domain_id, slug, pinned_brand_id, status
     from links where service_id = $1 and deleted_at is null order by created_at desc`,
    [serviceId],
  );
  return rows;
}

export async function get(c: pg.PoolClient, _ctx: Ctx, id: string): Promise<LinkRow> {
  const { rows } = await c.query<LinkRow>(
    `select id, org_id, service_id, domain_id, slug, pinned_brand_id, status
     from links where id = $1`,
    [id],
  );
  return orNotFound(rows[0]);
}

export async function softDelete(c: pg.PoolClient, id: string): Promise<void> {
  await c.query(
    `update links set deleted_at = now() where id = $1 and deleted_at is null`,
    [id],
  );
}
