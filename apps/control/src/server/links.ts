import "server-only";
import type { Ctx } from "@chameleon/db";
import { orNotFound } from "@chameleon/db";
import * as links from "@chameleon/db";
import { asTenant } from "./db";
import { conflict, invalid, notFound } from "./errors";
import { requireOwner } from "./session";

export interface LinkView {
  id: string;
  slug: string;
  hostname: string;
  domainStatus: string;
  brandName: string | null;
  brandSlug: string | null;
  status: string;
  url: string;
  createdAt: string;
}

export interface BrandOption {
  id: string;
  slug: string;
  name: string;
  emailDomains: string[];
}

const SELECT = `
  select l.id, l.slug, l.status, l.created_at as "createdAt",
         d.hostname, d.status as "domainStatus",
         b.name as "brandName", b.slug as "brandSlug"
    from links l
    join domains d on d.id = l.domain_id
    left join brands b on b.id = l.pinned_brand_id
   where l.service_id = $1 and l.deleted_at is null
`;

const origin = (hostname: string): string => `https://${hostname}`;

export async function listLinks(ctx: Ctx, serviceId: string): Promise<LinkView[]> {
  return asTenant(ctx, async (c) => {
    const { rows } = await c.query<Omit<LinkView, "url">>(
      `${SELECT} order by l.created_at desc`,
      [serviceId],
    );
    return rows.map((row) => ({ ...row, url: `${origin(row.hostname)}/${row.slug}` }));
  });
}

/** Brands are public and enabled ones are legal pins. */
export async function listBrands(): Promise<BrandOption[]> {
  return asTenant(
    { orgId: "00000000-0000-0000-0000-000000000000", userId: null, role: "member" },
    async (c) => {
      const { rows } = await c.query<BrandOption>(
        `select id, slug, name, email_domains as "emailDomains"
           from brands where enabled order by name`,
      );
      return rows;
    },
  );
}

export async function mintLink(
  ctx: Ctx,
  serviceId: string,
  input: { domainId: string; brandId: string },
): Promise<LinkView> {
  requireOwner(ctx);
  if (!input.domainId || !input.brandId) throw invalid("domain_and_brand_required");

  return asTenant(ctx, async (c) => {
    const service = await c.query<{ status: string }>(
      "select status from services where id = $1",
      [serviceId],
    );
    if (!service.rows[0]) throw notFound();
    if (service.rows[0].status !== "active") throw conflict("service_not_active");

    const domain = await c.query<{ id: string; status: string }>(
      `select id, status from domains
        where id = $1 and service_id = $2 and deleted_at is null`,
      [input.domainId, serviceId],
    );
    // Links on a host that does not route yet would be dead on arrival.
    if (!domain.rows[0]) throw notFound();
    if (domain.rows[0].status !== "active") throw conflict("domain_not_active");

    const brand = await c.query<{ id: string }>(
      "select id from brands where id = $1 and enabled",
      [input.brandId],
    );
    if (!brand.rows[0]) throw invalid("bad_brand");

    let row: links.links.LinkRow | null = null;
    for (let attempt = 0; attempt < 4 && !row; attempt += 1) {
      try {
        row = await links.links.mint(c, ctx, {
          serviceId,
          domainId: input.domainId,
          pin: input.brandId,
        });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== "23505" || attempt === 3) throw error;
      }
    }
    const found = orNotFound(row ?? undefined);
    const detail = await c.query<Omit<LinkView, "url">>(`${SELECT} and l.id = $2`, [
      serviceId,
      found.id,
    ]);
    const view = orNotFound(detail.rows[0]);
    return { ...view, url: `${origin(view.hostname)}/${view.slug}` };
  });
}

export async function revokeLink(ctx: Ctx, id: string): Promise<void> {
  requireOwner(ctx);
  await asTenant(ctx, async (c) => {
    const { rowCount } = await c.query(
      "update links set deleted_at = now() where id = $1 and deleted_at is null",
      [id],
    );
    if (!rowCount) throw notFound();
  });
}

export async function toggleLink(ctx: Ctx, id: string, status: string): Promise<void> {
  requireOwner(ctx);
  if (!["active", "paused"].includes(status)) throw invalid("bad_status");
  await asTenant(ctx, async (c) => {
    const { rowCount } = await c.query(
      "update links set status = $2 where id = $1 and deleted_at is null",
      [id, status],
    );
    if (!rowCount) throw notFound();
  });
}
