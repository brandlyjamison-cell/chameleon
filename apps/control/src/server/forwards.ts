import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Ctx } from "@chameleon/db";
import { orNotFound } from "@chameleon/db";
import { asTenant, requireDb } from "./db";
import { conflict, invalid, notFound } from "./errors";
import { requireOwner } from "./session";
import { captureMail, forwardVerificationMail } from "./mail";
import { enqueueEmail } from "./mailqueue";

export const MAX_ADDRESSES = 5;

export interface ForwardAddress {
  id: string;
  email: string;
  status: string;
  verifiedAt: string | null;
  createdAt: string;
}

function hash(raw: string): Buffer {
  return createHash("sha256").update(raw).digest();
}

export async function listAddresses(ctx: Ctx): Promise<ForwardAddress[]> {
  return asTenant(ctx, async (c) => {
    const { rows } = await c.query<ForwardAddress>(
      `select id, email, status, verified_at as "verifiedAt", created_at as "createdAt"
       from forward_addresses order by created_at desc`,
    );
    return rows;
  });
}

/**
 * The signup address is the zero-friction target: already proven by the account
 * itself. Any other address must round-trip a link before it can receive mail.
 */
export async function addAddress(
  ctx: Ctx & { email: string },
  email: string,
): Promise<{ verified: boolean }> {
  requireOwner(ctx);
  const target = email.trim().toLowerCase();

  const result = await asTenant(ctx, async (c) => {
    const count = await c.query<{ n: number }>(
      "select count(*)::int as n from forward_addresses",
    );
    if ((count.rows[0]?.n ?? 0) >= MAX_ADDRESSES) throw conflict("address_cap");

    if (target === ctx.email.toLowerCase()) {
      await c.query(
        `insert into forward_addresses (org_id, email, status, verified_at)
         values ($1, $2, 'verified', now())
         on conflict (org_id, email) do update set status = 'verified', verified_at = now()`,
        [ctx.orgId, target],
      );
      return { verified: true, token: null };
    }

    const raw = randomBytes(32).toString("base64url");
    await c.query(
      `insert into forward_addresses (org_id, email, status, token_hash, expires_at)
       values ($1, $2, 'pending', $3, now() + interval '24 hours')
       on conflict (org_id, email) do update
         set status = 'pending', token_hash = excluded.token_hash,
             expires_at = excluded.expires_at, verified_at = null`,
      [ctx.orgId, target, hash(raw)],
    );
    return { verified: false, token: raw };
  });

  if (!result.verified && result.token) {
    const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
    const url = `${base}/api/forwards/verify?token=${result.token}`;
    const mail = forwardVerificationMail(target, url);
    await enqueueEmail({ kind: "forward", to: target, ...mail });
  }
  return { verified: result.verified };
}

export async function removeAddress(ctx: Ctx, id: string): Promise<void> {
  requireOwner(ctx);
  await asTenant(ctx, async (c) => {
    const res = await c.query("delete from forward_addresses where id = $1", [id]);
    if (res.rowCount === 0) throw notFound();
  });
}

/** Called from the link with no session; returns the org for the redirect. */
export async function verifyForward(token: string): Promise<string | null> {
  if (!token) return null;
  const { rows } = await requireDb().pool.query<{ verify_forward_token: string | null }>(
    "select verify_forward_token($1)",
    [hash(token)],
  );
  return rows[0]?.verify_forward_token ?? null;
}

/** Newest capture on the service, as a plain object for the mail renderer. */
export async function queueLatestCapture(
  ctx: Ctx & { email: string },
  serviceId: string,
  addressId: string,
): Promise<void> {
  requireOwner(ctx);

  const address = await asTenant(ctx, async (c) => {
    const { rows } = await c.query<{ email: string; status: string }>(
      "select email, status from forward_addresses where id = $1",
      [addressId],
    );
    const row = orNotFound(rows[0]);
    // The signup address is verified by definition, even if the row was never
    // written; sending to ourselves needs no second proof.
    if (
      row.status !== "verified" &&
      row.email.toLowerCase() !== ctx.email.toLowerCase()
    ) {
      throw conflict("address_unverified");
    }
    return row.email;
  });

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
       where c.service_id = $1
       order by c.received_at desc limit 1`,
      [serviceId],
    );
    return orNotFound(rows[0]);
  });

  if (!capture.fields || Object.keys(capture.fields).length === 0) {
    throw invalid("capture_malformed");
  }

  const mail = captureMail({
    serviceType: capture.service_type,
    receivedAt: capture.received_at,
    fields: capture.fields,
    source: capture.source,
  });
  await enqueueEmail({ orgId: ctx.orgId, kind: "forward", to: address, ...mail });
}
