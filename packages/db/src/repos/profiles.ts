import type pg from "pg";
import { orNotFound, type Ctx } from "../ctx";

/** A cloned-page profile: what a crawler saw, kept for 30 days (ADR 0034). */
export interface ProfileRow {
  id: string;
  org_id: string;
  service_id: string | null;
  email_domain: string;
  profile: Record<string, unknown>;
  status: "generated" | "accepted" | "rejected" | "failed";
  step_count: number;
  source_url: string | null;
  brand_name: string | null;
  logo_asset_id: string | null;
  screenshot_asset_id: string | null;
  fetched_from: string | null;
  expires_at: Date;
  fail_reason: string | null;
  created_at: Date;
}

const COLS = `id, org_id, service_id, email_domain, profile, status, step_count,
  source_url, brand_name, logo_asset_id, screenshot_asset_id, fetched_from,
  expires_at, fail_reason, created_at`;

export async function create(
  c: pg.PoolClient,
  ctx: Ctx,
  input: {
    serviceId: string;
    emailDomain: string;
    profile: Record<string, unknown>;
    stepCount: number;
    sourceUrl: string;
    brandName: string;
    fetchedFrom: string;
  },
): Promise<ProfileRow> {
  const { rows } = await c.query<ProfileRow>(
    `insert into profiles (org_id, service_id, email_domain, profile, step_count,
       source_url, brand_name, fetched_from)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning ${COLS}`,
    [
      ctx.orgId,
      input.serviceId,
      input.emailDomain,
      input.profile,
      input.stepCount,
      input.sourceUrl,
      input.brandName,
      input.fetchedFrom,
    ],
  );
  return orNotFound(rows[0]);
}

export async function get(c: pg.PoolClient, ctx: Ctx, id: string): Promise<ProfileRow> {
  const { rows } = await c.query<ProfileRow>(
    `select ${COLS} from profiles where id = $1 and org_id = $2`,
    [id, ctx.orgId],
  );
  return orNotFound(rows[0]);
}

export async function listForService(
  c: pg.PoolClient,
  ctx: Ctx,
  serviceId: string,
): Promise<ProfileRow[]> {
  const { rows } = await c.query<ProfileRow>(
    `select ${COLS} from profiles
      where service_id = $1 and org_id = $2 order by created_at desc limit 20`,
    [serviceId, ctx.orgId],
  );
  return rows;
}

/** The newest clone that still passes review; what a link renders by default. */
export async function latestUsable(
  c: pg.PoolClient,
  ctx: Ctx,
  serviceId: string,
): Promise<ProfileRow | null> {
  const { rows } = await c.query<ProfileRow>(
    `select ${COLS} from profiles
      where service_id = $1 and org_id = $2 and status in ('generated', 'accepted')
        and expires_at > now()
      order by created_at desc limit 1`,
    [serviceId, ctx.orgId],
  );
  return rows[0] ?? null;
}

export async function setStatus(
  c: pg.PoolClient,
  ctx: Ctx,
  id: string,
  status: ProfileRow["status"],
  failReason: string | null = null,
): Promise<void> {
  await c.query(
    `update profiles set status = $3, fail_reason = $4
      where id = $1 and org_id = $2`,
    [id, ctx.orgId, status, failReason],
  );
}

/** Bytes live in Neon for now; R2 is the documented next step (open question). */
export async function addAsset(
  c: pg.PoolClient,
  ctx: Ctx,
  profileId: string,
  kind: "logo" | "screenshot" | "favicon",
  mime: string,
  bytes: Buffer,
  sha256: Buffer,
): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `insert into profile_assets (org_id, profile_id, kind, mime, bytes, sha256)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [ctx.orgId, profileId, kind, mime, bytes, sha256],
  );
  return orNotFound(rows[0]).id;
}

export async function point(
  c: pg.PoolClient,
  ctx: Ctx,
  profileId: string,
  patch: { logoAssetId?: string | null; screenshotAssetId?: string | null },
): Promise<void> {
  await c.query(
    `update profiles set
       logo_asset_id = coalesce($3, logo_asset_id),
       screenshot_asset_id = coalesce($4, screenshot_asset_id)
     where id = $1 and org_id = $2`,
    [profileId, ctx.orgId, patch.logoAssetId ?? null, patch.screenshotAssetId ?? null],
  );
}
