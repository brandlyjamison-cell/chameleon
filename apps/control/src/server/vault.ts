import "server-only";
import type { Ctx } from "@chameleon/db";
import { orNotFound } from "@chameleon/db";
import { asTenant } from "./db";
import { conflict, invalid, notFound } from "./errors";
import { captureMail } from "./mail";
import { enqueueEmail } from "./mailqueue";
import { requireOwner } from "./session";
import { listAddresses } from "./forwards";

export interface VaultCapture {
  id: string;
  serviceId: string;
  serviceType: string;
  slug: string | null;
  hostname: string | null;
  kind: string;
  source: string;
  status: string;
  fields: Record<string, unknown>;
  receivedAt: string;
}

export interface VaultFilter {
  serviceId?: string | undefined;
  status?: string | undefined;
  source?: string | undefined;
  q?: string | undefined;
  limit?: number;
  offset?: number;
}

const WHERE = `
  where ($1::uuid is null or c.service_id = $1)
    and ($2::text is null or c.status = $2)
    and ($3::text is null or c.source = $3)
    and ($4::text is null or c.fields->>'username' ilike '%' || $4 || '%' or l.slug = upper($4))
`;

const SELECT = `
  select c.id, c.service_id as "serviceId", st.code as "serviceType",
         l.slug, d.hostname, c.kind, c.source, c.status, c.fields,
         c.received_at as "receivedAt"
    from captures c
    join services s on s.id = c.service_id
    join service_types st on st.id = s.service_type_id
    left join links l on l.id = c.link_id
    left join domains d on d.id = l.domain_id
`;

function args(filter: VaultFilter): unknown[] {
  return [
    filter.serviceId ?? null,
    filter.status && filter.status !== "all" ? filter.status : null,
    filter.source && filter.source !== "all" ? filter.source : null,
    filter.q?.trim() ? filter.q.trim() : null,
  ];
}

export async function listCaptures(
  ctx: Ctx,
  filter: VaultFilter = {},
): Promise<VaultCapture[]> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  return asTenant(ctx, async (c) => {
    const { rows } = await c.query<VaultCapture>(
      `${SELECT} ${WHERE} order by c.received_at desc, c.id desc limit $5 offset $6`,
      [...args(filter), limit, offset],
    );
    return rows;
  });
}

export async function countCaptures(
  ctx: Ctx,
  filter: VaultFilter = {},
): Promise<{ total: number; valid: number; new: number; invalid: number }> {
  return asTenant(ctx, async (c) => {
    const { rows } = await c.query<{
      total: string;
      valid: string;
      fresh: string;
      invalid: string;
    }>(
      `select count(*)::text as total,
              count(*) filter (where c.status = 'valid')::text as valid,
              count(*) filter (where c.status = 'new')::text as fresh,
              count(*) filter (where c.status = 'invalid')::text as invalid
         from captures c left join links l on l.id = c.link_id ${WHERE}`,
      args(filter),
    );
    const row = rows[0];
    return {
      total: Number(row?.total ?? 0),
      valid: Number(row?.valid ?? 0),
      new: Number(row?.fresh ?? 0),
      invalid: Number(row?.invalid ?? 0),
    };
  });
}

export async function setCaptureStatus(
  ctx: Ctx,
  id: string,
  status: string,
): Promise<void> {
  requireOwner(ctx);
  if (!["new", "valid", "invalid"].includes(status)) throw invalid("bad_status");
  await asTenant(ctx, async (c) => {
    const { rowCount } = await c.query("update captures set status = $2 where id = $1", [
      id,
      status,
    ]);
    if (!rowCount) throw notFound();
  });
}

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

/** Streams in memory; capped at the tier ceiling, which is far below a problem. */
export async function exportCsv(ctx: Ctx, filter: VaultFilter = {}): Promise<string> {
  const rows = await listCaptures(ctx, { ...filter, limit: 200, offset: 0 });
  const header = "received_at,status,source,service,host,slug,username,password";
  const lines = rows.map((row) =>
    [
      row.receivedAt,
      row.status,
      row.source,
      row.serviceType,
      row.hostname ?? "",
      row.slug ?? "",
      row.fields.username ?? "",
      row.fields.password ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [header, ...lines].join("\n");
}

/** Mail one capture to every verified address on the org. */
export async function forwardCapture(
  ctx: Ctx & { email: string },
  id: string,
): Promise<number> {
  requireOwner(ctx);
  const addresses = (await listAddresses(ctx)).filter(
    (address) =>
      address.status === "verified" ||
      address.email.toLowerCase() === ctx.email.toLowerCase(),
  );
  if (addresses.length === 0) throw conflict("no_address");

  const capture = await asTenant(ctx, async (c) => {
    const { rows } = await c.query<{
      fields: Record<string, unknown>;
      received_at: Date;
      source: string;
      service_type: string;
    }>(
      `select c.fields, c.received_at, c.source, st.code as service_type
         from captures c
         join services s on s.id = c.service_id
         join service_types st on st.id = s.service_type_id
        where c.id = $1`,
      [id],
    );
    return orNotFound(rows[0]);
  });

  const message = captureMail({
    serviceType: capture.service_type,
    receivedAt: capture.received_at,
    fields: capture.fields,
    source: capture.source,
  });
  for (const address of addresses) {
    await enqueueEmail({
      orgId: ctx.orgId,
      kind: "forward",
      to: address.email,
      ...message,
    });
  }
  return addresses.length;
}
