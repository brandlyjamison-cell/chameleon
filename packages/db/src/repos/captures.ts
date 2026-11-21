import type pg from "pg";
import type { Ctx } from "../ctx";

/** Mirrors set_capture_bucket() exactly; the bucket must be known on conflict. */
export function bucketOf(at: Date): string {
  const iso = at.toISOString();
  const minute = Math.floor(Number(iso.slice(14, 16)) / 15) * 15;
  return `${iso.slice(0, 13)}:${String(minute).padStart(2, "0")}`;
}

export interface NewCapture {
  id: string;
  serviceId: string;
  linkId: string;
  kind: "credential" | "session" | "mixed";
  fields: unknown;
  payloadRef?: string | null;
  emailHash: Buffer | null;
  source: "human" | "decoy" | "scanner";
  receivedAt: Date;
}

/**
 * Inserts, dedupes on the 15-minute bucket, and prunes past the cap — all in the
 * caller's transaction (INV-CAP-07/09).
 */
export async function consume(
  c: pg.PoolClient,
  _ctx: Ctx,
  input: NewCapture,
): Promise<{ inserted: boolean; pruned: number }> {
  const { rows } = await c.query<{ id: string }>(
    `insert into captures (id, org_id, service_id, link_id, kind, fields, payload_ref,
       email_hash, source, received_at)
     values ($1, (select org_id from services where id = $2), $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (service_id, email_hash, dedupe_bucket) where email_hash is not null do nothing
     returning id`,
    [
      input.id,
      input.serviceId,
      input.linkId,
      input.kind,
      input.fields,
      input.payloadRef ?? null,
      input.emailHash,
      input.source,
      input.receivedAt,
    ],
  );

  if (rows.length === 0) {
    await c.query(`select suppress_capture($1, $2)`, [
      input.serviceId,
      bucketOf(new Date(input.receivedAt)),
    ]);
    return { inserted: false, pruned: 0 };
  }

  const cap = await c.query<{ capture_cap: number }>(
    `select t.capture_cap from services s join tiers t on t.id = s.tier_id where s.id = $1`,
    [input.serviceId],
  );
  const limit = cap.rows[0]?.capture_cap ?? 0;
  const pruned = await c.query<{ prune_captures: number }>(
    `select prune_captures($1, $2)`,
    [input.serviceId, limit],
  );
  return { inserted: true, pruned: pruned.rows[0]?.prune_captures ?? 0 };
}

export async function listForService(
  c: pg.PoolClient,
  serviceId: string,
  options: { includeScanner?: boolean; limit?: number } = {},
): Promise<
  Array<{ id: string; source: string; status: string; kind: string; received_at: Date }>
> {
  const { rows } = await c.query(
    `select id, source, status, kind, received_at from captures
     where service_id = $1
       and ($2::boolean or source <> 'scanner')
     order by received_at desc, id desc limit $3`,
    [serviceId, options.includeScanner ?? false, options.limit ?? 50],
  );
  return rows;
}
