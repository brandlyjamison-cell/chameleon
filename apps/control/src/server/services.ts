import "server-only";
import type pg from "pg";
import type { Ctx } from "@chameleon/db";
import {
  orNotFound,
  preview as previewRepo,
  links as linkRepo,
  withTenant,
} from "@chameleon/db";
import type { ActivateSchema, CreateServiceSchema } from "@chameleon/contracts";
import type { z } from "zod";
import { defaultServiceName } from "@chameleon/engine";
import { asTenant, requireDb } from "./db";
import { conflict, invalid } from "./errors";
import { createVerifier, derive, verifyPasscode } from "./passcode";
import { assertPaid } from "./billing";
import { KEK_KID, newDek, newSecret, unwrapDek, wrapDek } from "./keys";
import { requireOwner } from "./session";

export type SubscriptionState =
  "paid" | "due" | "unpaid" | "expired" | "provisioning" | "inactive";

export interface ServiceView {
  id: string;
  status: string;
  subscription: SubscriptionState;
  name: string;
  previewKey: string;
  previewSlug: string | null;
  serviceType: string;
  tier: string;
  gateMode: string;
  expiresAt: string | null;
  activatedAt: string | null;
  createdAt: string;
  paidUntil: string | null;
  priceCents: number;
  linkCap: number;
  hostnameCap: number;
  linksUsed: number;
  hostnamesUsed: number;
}

// Aliases are quoted because the view is camelCase and the row goes straight out.
const VIEW_SQL = `
  select s.id, s.status, s.name, s.preview_key as "previewKey",
         st.code as "serviceType", t.code as tier,
         s.gate_mode as "gateMode", s.expires_at as "expiresAt",
         s.activated_at as "activatedAt", s.created_at as "createdAt",
         s.paid_until as "paidUntil", t.price_cents as "priceCents",
         t.link_cap as "linkCap", t.hostname_cap as "hostnameCap",
         s.link_slots_used as "linksUsed", s.hostname_slots_used as "hostnamesUsed",
         (select l.slug from links l
           where l.service_id = s.id and l.is_preview and l.deleted_at is null) as "previewSlug"
  from services s
  join service_types st on st.id = s.service_type_id
  join tiers t on t.id = s.tier_id`;

/**
 * One source of truth for "what is this service, commercially". The header pill,
 * the payment card and any banner read this, so an active-but-unpaid service can
 * never present as Active and Payment required at the same time.
 */
export function subscriptionState(service: {
  status: string;
  paidUntil: string | null;
  activatedAt: string | null;
}): SubscriptionState {
  if (service.status === "archived" || service.status === "suspended") return "inactive";
  if (service.status === "expired") return "expired";
  const paid =
    service.paidUntil !== null && new Date(service.paidUntil).getTime() > Date.now();
  if (paid) return "paid";
  if (service.status === "provisioning" || !service.activatedAt) return "provisioning";
  return "due";
}

const withSubscription = <
  T extends { status: string; paidUntil: string | null; activatedAt: string | null },
>(
  row: T,
): T & { subscription: SubscriptionState } => ({
  ...row,
  subscription: subscriptionState(row),
});

export async function listServices(ctx: Ctx): Promise<ServiceView[]> {
  return asTenant(ctx, async (c) => {
    const { rows } = await c.query<ServiceView>(
      `${VIEW_SQL} where true order by s.created_at desc`,
    );
    return rows.map(withSubscription);
  });
}

export async function getService(ctx: Ctx, id: string): Promise<ServiceView> {
  return asTenant(ctx, async (c) => {
    const { rows } = await c.query<ServiceView>(`${VIEW_SQL} where s.id = $1`, [id]);
    const row = orNotFound(rows[0]);
    return withSubscription(row);
  });
}

/** A service is created unverified and unactivated; activation does the work. */
export async function createService(
  ctx: Ctx,
  input: z.infer<typeof CreateServiceSchema>,
): Promise<ServiceView> {
  requireOwner(ctx);
  return asTenant(ctx, async (c) => {
    const type = await c.query<{ id: number }>(
      "select id from service_types where code = $1 and status = 'active'",
      [input.serviceType],
    );
    const typeId = orNotFound(type.rows[0]).id;
    const tier = await c.query<{ id: number }>(
      "select id from tiers where service_type_id = $1 and code = $2",
      [typeId, input.tier],
    );
    const tierId = orNotFound(tier.rows[0]).id;

    const name = input.name?.trim() || defaultServiceName(input.serviceType, input.tier);

    let id: string;
    try {
      const { rows } = await c.query<{ id: string }>(
        `insert into services (org_id, service_type_id, tier_id, name)
         values ($1, $2, $3, $4) returning id`,
        [ctx.orgId, typeId, tierId, name],
      );
      id = orNotFound(rows[0]).id;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw conflict("name_taken");
      throw error;
    }
    // One free preview link per service, minted before the tenant does anything.
    await previewRepo.ensurePreviewLink(c, id, () => linkRepo.slug());
    const view = await c.query<ServiceView>(`${VIEW_SQL} where s.id = $1`, [id]);
    return withSubscription(orNotFound(view.rows[0]));
  });
}

interface ActivationRow {
  id: string;
  status: string;
  gate_mode: string;
  passcode_hash: Buffer | null;
  passcode_salt: Buffer | null;
  dek_wrapped: Buffer | null;
  token_secret: Buffer | null;
  activated_at: Date | null;
  emailVerified: boolean;
}

/**
 * One transaction (acceptance 2): verifier, wrap, activated_at and status move
 * together. Re-running resumes from whatever columns exist (acceptance 3) —
 * the stored salt is reused when the passcode still matches, so a retry after a
 * crash does not invalidate a wrap already written.
 */
export async function activate(
  c: pg.PoolClient,
  ctx: Ctx,
  serviceId: string,
  input: z.infer<typeof ActivateSchema>,
): Promise<void> {
  requireOwner(ctx);
  const { rows } = await c.query<ActivationRow>(
    `select s.id, s.status, s.gate_mode, s.passcode_hash, s.passcode_salt, s.dek_wrapped,
            s.token_secret, s.activated_at, u."emailVerified"
     from services s join auth_user u on u.id = $2
     where s.id = $1 for update of s`,
    [serviceId, ctx.userId],
  );
  const row = orNotFound(rows[0]);

  if (row.status === "active" && row.activated_at) return;
  if (!row.emailVerified) throw conflict("email_unverified");

  // Money comes before keys: nothing is wrapped until the period is paid.
  await assertPaid(c, serviceId);

  let salt = row.passcode_salt;
  let verifier = row.passcode_hash;
  if (salt && verifier) {
    // The wrap is already keyed to this passcode; a different one would need the
    // old passcode to rewrap, so refuse rather than silently orphan the DEK.
    if (!(await verifyPasscode(input.passcode, { hash: verifier, salt }))) {
      throw invalid("passcode_mismatch");
    }
  } else {
    const fresh = await createVerifier(input.passcode);
    salt = fresh.salt;
    verifier = fresh.hash;
  }
  const wrappingKey = await derive(input.passcode, salt);

  let wrapped = row.dek_wrapped;
  if (!wrapped) {
    wrapped = await wrapDek(await newDek(), wrappingKey);
  } else {
    // Prove the existing blob opens with the passcode before claiming success.
    const existing = await unwrapDek(wrapped, wrappingKey);
    wrapped = await wrapDek(existing, wrappingKey);
  }

  await c.query(
    `update services set
       passcode_hash = $2, passcode_salt = $3, dek_wrapped = $4,
       dek_wrap_kind = 'passcode', dek_kid = $5,
       token_secret = coalesce(token_secret, $6),
       gate_mode = $7, status = 'active', activated_at = now(),
       expires_at = now() + interval '30 days'
     where id = $1`,
    [serviceId, verifier, salt, wrapped, KEK_KID, newSecret(), input.gateMode],
  );
}

/** Route-level wrapper: activation always owns its transaction. */
export function activateIn(
  ctx: Ctx,
  serviceId: string,
  input: z.infer<typeof ActivateSchema>,
): Promise<void> {
  return withTenant(requireDb(), ctx, (c) => activate(c, ctx, serviceId, input));
}
