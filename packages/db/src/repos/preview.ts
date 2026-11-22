import type pg from "pg";
import { orNotFound } from "../ctx";

/**
 * The preview path is anonymous: these reads go through definer functions, not the
 * tenant policies (ADR 0033).
 */
export interface PreviewRow {
  link_id: string;
  org_id: string;
  service_id: string;
  service_type: string;
  slug: string;
  status: string;
  expires_at: Date | null;
  source: "pin" | "brand_map" | "profile" | "cpanel";
  brand_slug: string;
  template_key: string;
  brand_name: string;
  title: string;
  step_count: number;
  redirect_to: string;
  palette: Record<string, string>;
  labels: Record<string, string>;
  logo_asset_id: string | null;
  backdrop_asset_id: string | null;
}

export async function resolvePreview(
  c: pg.PoolClient,
  key: string,
  slug: string,
): Promise<PreviewRow | null> {
  const { rows } = await c.query<PreviewRow>("select * from preview_render($1, $2)", [
    key,
    slug.toUpperCase(),
  ]);
  return rows[0] ?? null;
}

export interface PreviewLink {
  id: string;
  service_id: string;
  slug: string;
}

/** One preview per service, forever: the second call returns the same one. */
export async function ensurePreviewLink(
  c: pg.PoolClient,
  serviceId: string,
  makeSlug: () => string,
): Promise<PreviewLink> {
  const existing = await c.query<PreviewLink>(
    `select id, service_id, slug from links
      where service_id = $1 and is_preview and deleted_at is null`,
    [serviceId],
  );
  if (existing.rows[0]) return existing.rows[0];
  const { rows } = await c.query<PreviewLink>(
    `insert into links (org_id, service_id, slug, is_preview)
     values ((select org_id from services where id = $1), $1, $2, true)
     on conflict (service_id) where is_preview and deleted_at is null
     do update set slug = links.slug
     returning id, service_id, slug`,
    [serviceId, makeSlug()],
  );
  return orNotFound(rows[0]);
}

export async function assetFor(
  c: pg.PoolClient,
  id: string,
): Promise<{ mime: string; bytes: Buffer } | null> {
  const { rows } = await c.query<{ mime: string; bytes: Buffer }>(
    "select * from profile_asset($1)",
    [id],
  );
  return rows[0] ?? null;
}
