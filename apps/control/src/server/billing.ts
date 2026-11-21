import "server-only";
import type { PoolClient } from "pg";
import { createHmac, timingSafeEqual } from "node:crypto";
import { withTenant, type Ctx } from "@chameleon/db";
import { requireDb } from "./db";
import { requireOwner } from "./session";
import { conflict, forbidden, invalid, notFound } from "./errors";
import { receiptMail } from "./mail";
import { enqueueEmail } from "./mailqueue";

const API = process.env.NOWPAYMENTS_API_BASE ?? "https://api.nowpayments.io/v1";
const PUBLIC_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const DAYS = 30;
const CURRENCY = "usd";

export class BillingOff extends Error {
  readonly status = 503;
  readonly code = "billing_off";
}

export interface PaymentView {
  id: string;
  status: string;
  priceCents: number;
  checkoutUrl: string | null;
  periodEnd: string | null;
}

/** A service needs both a confirmed payment and an unspent period to activate. */
export async function assertPaid(c: PoolClient, serviceId: string) {
  const { rows } = await c.query<{ paid_until: Date | null; price_cents: number }>(
    `select s.paid_until, t.price_cents
     from services s join tiers t on t.id = s.tier_id
     where s.id = $1`,
    [serviceId],
  );
  const row = rows[0];
  if (!row) throw notFound();
  if (!row.paid_until || row.paid_until.getTime() <= Date.now()) {
    throw conflict("payment_required");
  }
  return row;
}

/**
 * Opens a checkout for one service. The term is fixed here, so a later IPN can
 * only confirm the money, never extend the period.
 */
export async function checkout(ctx: Ctx, serviceId: string): Promise<PaymentView> {
  requireOwner(ctx);
  const key = process.env.NOWPAYMENTS_API_KEY;
  if (!key) throw new BillingOff();

  return withTenant(requireDb(), ctx, async (c) => {
    const { rows } = await c.query<{
      org_id: string;
      tier_id: number;
      price_cents: number;
      tier: string;
      paid_until: Date | null;
      status: string;
    }>(
      `select s.org_id, s.tier_id, t.price_cents, t.code as tier, s.paid_until, s.status
       from services s join tiers t on t.id = s.tier_id
       where s.id = $1 for update of s`,
      [serviceId],
    );
    const svc = rows[0];
    if (!svc) throw notFound();
    if (svc.status === "archived") throw conflict("service_archived");

    const start =
      svc.paid_until && svc.paid_until.getTime() > Date.now()
        ? svc.paid_until
        : new Date();
    const end = new Date(start.getTime() + DAYS * 86_400_000);

    const { rows: created } = await c.query<{ id: string }>(
      `insert into payments (org_id, service_id, tier_id, price_cents, period_start, period_end)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [svc.org_id, serviceId, svc.tier_id, svc.price_cents, start, end],
    );
    const paymentId = created[0]!.id;

    const res = await fetch(`${API}/invoice`, {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        price_amount: svc.price_cents / 100,
        price_currency: CURRENCY,
        order_id: paymentId,
        order_description: `Chameleon ${svc.tier} — ${DAYS} days`,
        ipn_callback_url: `${PUBLIC_URL}/api/payments/ipn`,
        success_url: `${PUBLIC_URL}/services/${serviceId}?paid=1`,
        cancel_url: `${PUBLIC_URL}/services/${serviceId}?paid=0`,
        is_fixed_rate: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      await c.query(`update payments set status = 'failed' where id = $1`, [paymentId]);
      const body = (await res.text()).slice(0, 200);
      throw invalid(`payment_provider_${res.status}:${body}`);
    }

    const invoice = (await res.json()) as { id?: string | number; invoice_url?: string };
    if (!invoice.invoice_url) throw invalid("payment_provider_shape");

    await c.query(
      `update payments set provider_payment_id = $2, checkout_url = $3 where id = $1`,
      [paymentId, String(invoice.id ?? paymentId), invoice.invoice_url],
    );

    return {
      id: paymentId,
      status: "pending",
      priceCents: svc.price_cents,
      checkoutUrl: invoice.invoice_url,
      periodEnd: end.toISOString(),
    };
  });
}

export async function latestPayment(
  ctx: Ctx,
  serviceId: string,
): Promise<PaymentView | null> {
  return withTenant(requireDb(), ctx, async (c) => {
    const { rows } = await c.query<{
      id: string;
      status: string;
      price_cents: number;
      checkout_url: string | null;
      period_end: Date;
    }>(
      `select id, status, price_cents, checkout_url, period_end
       from payments where service_id = $1 order by created_at desc limit 1`,
      [serviceId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      status: row.status,
      priceCents: row.price_cents,
      checkoutUrl: row.checkout_url,
      periodEnd: row.period_end.toISOString(),
    };
  });
}

/** HMAC-SHA512 over the raw body with keys sorted, as NowPayments signs it. */
export function validSignature(raw: string, signature: string | null): boolean {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret) return false;
  if (!signature) return false;
  const sorted = JSON.stringify(sortKeys(JSON.parse(raw)));
  const expected = createHmac("sha512", secret).update(sorted).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

export interface IpnResult {
  status: string;
  serviceId: string | null;
}

/**
 * Applies an IPN. Cross-tenant by nature, so it goes through the definer function;
 * without a signature secret it refuses rather than trusting the body.
 */
export async function handleIpn(
  raw: string,
  signature: string | null,
): Promise<IpnResult> {
  if (!validSignature(raw, signature)) throw forbidden("bad_signature");
  const body = JSON.parse(raw) as {
    payment_status?: string;
    invoice_id?: string | number;
    payment_id?: string | number;
    order_id?: string;
  };
  const status = body.payment_status;
  const providerId = String(body.invoice_id ?? body.payment_id ?? "");
  if (!status || !providerId) throw invalid("bad_ipn");

  const { rows } = await requireDb().pool.query<{
    service_id: string;
    status: string;
    fresh: boolean;
  }>("select * from apply_payment_status($1, $2, $3)", [
    providerId,
    status,
    JSON.stringify(body),
  ]);
  const result = {
    status: rows[0]?.status ?? "unknown",
    serviceId: rows[0]?.service_id ?? null,
  };
  // Only the IPN that actually confirmed buys a receipt; a replay does not.
  if (result.status === "confirmed" && result.serviceId && rows[0]?.fresh) {
    await sendReceipt(providerId).catch(() => undefined);
  }
  return result;
}

/** A receipt to the owner, once per confirmed payment. Mail never throws. */
async function sendReceipt(providerId: string): Promise<void> {
  const { rows } = await requireDb().pool.query<{
    org_id: string;
    price_cents: number;
    period_end: Date;
    service_type: string;
    email: string;
  }>("select * from receipt_target($1)", [providerId]);
  const row = rows[0];
  if (!row) return;
  const mail = receiptMail({
    serviceType: row.service_type,
    amountCents: row.price_cents,
    periodEnd: row.period_end,
    invoiceId: providerId,
  });
  await enqueueEmail({ orgId: row.org_id, kind: "receipt", to: row.email, ...mail });
}
