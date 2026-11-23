import "server-only";
import { after } from "next/server";
import { asTenant, requireDb } from "./db";
import type { Ctx } from "@chameleon/db";
import { mailLimits, sendMail, type MailLimits } from "./mail";

export type MailKind =
  "verify" | "invoice" | "receipt" | "forward" | "warning" | "system";

export interface Outgoing {
  orgId?: string | null;
  kind: MailKind;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface DrainResult {
  sent: number;
  failed: number;
  throttled: number;
  /** True when the daily quota is spent and no row was claimed at all. */
  parked: boolean;
}

/** Inside this window before a reset, claiming is pointless: hold the batch. */
const PARK_MARGIN_MS = 60_000;

export function quotaSpent(limits: MailLimits | null): boolean {
  if (!limits?.overQuota) return false;
  if (!limits.resetsAt) return true;
  return limits.resetsAt.getTime() - Date.now() > -PARK_MARGIN_MS;
}

interface QueuedRow {
  id: string;
  to_address: string;
  subject: string;
  text_body: string;
  html_body: string | null;
}

/**
 * Queues a message. Never throws: a broken queue must not fail a signup or a
 * payment webhook.
 *
 * The response does not wait for delivery. Outside `MAIL_INLINE` the drain is
 * scheduled with `after()`, so the connection is reused and the message usually
 * leaves in under a second instead of waiting for the 30 s timer. The timer
 * stays as the safety net for retries and anything a crashed request dropped.
 */
export async function enqueueEmail(mail: Outgoing): Promise<boolean> {
  console.log(`[mail] queued ${mail.kind} -> ${mail.to}`);
  try {
    await requireDb().pool.query("select enqueue_email($1, $2, $3, $4, $5, $6)", [
      mail.orgId ?? null,
      mail.kind,
      mail.to,
      mail.subject,
      mail.text,
      mail.html ?? null,
    ]);
  } catch (error) {
    console.error("[mail] enqueue failed", (error as Error).message);
    return false;
  }
  if (process.env.MAIL_INLINE) {
    await drain(10).catch(() => undefined);
  } else {
    try {
      after(() => drain(10).catch(() => undefined));
    } catch {
      // Not inside a request (CLI, job): the timer will pick it up.
    }
  }
  return true;
}

/** Sends whatever is due. Backoff and the 6-try ceiling live in `finish_email`. */
export async function drain(limit = 20, force = false): Promise<DrainResult> {
  const limits = await mailLimits();
  if (!force && quotaSpent(limits)) {
    const stats = await mailStats().catch(() => null);
    if (stats) warnIfStale(stats, limits);
    return { sent: 0, failed: 0, throttled: 0, parked: true };
  }

  const { rows } = await requireDb().pool.query<QueuedRow>(
    "select * from claim_emails($1)",
    [limit],
  );
  let sent = 0;
  let failed = 0;
  let throttled = 0;
  for (const row of rows) {
    const outcome = await sendMail({
      to: row.to_address,
      subject: row.subject,
      text: row.text_body,
      ...(row.html_body ? { html: row.html_body } : {}),
    });
    await requireDb()
      .pool.query("select finish_email($1, $2, $3)", [
        row.id,
        outcome,
        outcome === "sent"
          ? null
          : outcome === "throttled"
            ? "throttled by provider"
            : "provider refused",
      ])
      .catch(() => undefined);
    if (outcome === "sent") sent += 1;
    else if (outcome === "throttled") throttled += 1;
    else failed += 1;
    // Quota is account-wide: stop the batch instead of 429-ing every row.
    if (outcome === "throttled") {
      const rest = rows.slice(rows.indexOf(row) + 1);
      for (const pending of rest) {
        await requireDb()
          .pool.query("select finish_email($1, 'throttled', $2)", [
            pending.id,
            "provider throttled",
          ])
          .catch(() => undefined);
        throttled += 1;
      }
      break;
    }
  }
  const result = { sent, failed, throttled, parked: false };
  await mailStats()
    .then((stats) => warnIfStale(stats, limits))
    .catch(() => undefined);
  return result;
}

export interface QueueRow {
  id: string;
  kind: string;
  to_address: string;
  subject: string;
  status: string;
  attempts: number;
  last_error: string | null;
  available_at: Date;
  created_at: Date;
  sent_at: Date | null;
}

export async function listQueue(limit = 100): Promise<QueueRow[]> {
  // Definer function: the queue is read across tenants and the pool may carry an
  // empty `app.org_id`.
  const { rows } = await requireDb().pool.query<QueueRow>(
    "select * from admin_emails($1)",
    [limit],
  );
  return rows;
}

export async function requeue(id: string): Promise<void> {
  await requireDb().pool.query("select requeue_email($1)", [id]);
}

export interface MailStats {
  queued: number;
  sending: number;
  failed24h: number;
  oldestQueuedSeconds: number;
}

/** Backlog depth for the health probe and the operator dashboard. */
export async function mailStats(): Promise<MailStats> {
  const { rows } = await requireDb().pool.query<{
    queued: string;
    sending: string;
    failed_24h: string;
    oldest_queued_seconds: string;
  }>("select * from mail_stats()");
  const row = rows[0];
  return {
    queued: Number(row?.queued ?? 0),
    sending: Number(row?.sending ?? 0),
    failed24h: Number(row?.failed_24h ?? 0),
    oldestQueuedSeconds: Number(row?.oldest_queued_seconds ?? 0),
  };
}

/**
 * A backlog older than five minutes means the drain itself is broken, not that
 * one recipient is throttled. While the daily quota is spent the backlog is
 * expected, so it only counts once the queue stops being parked.
 */
export function warnIfStale(stats: MailStats, limits?: MailLimits | null): void {
  if (quotaSpent(limits ?? null)) return;
  if (stats.oldestQueuedSeconds > 300) {
    console.warn(
      `[mail] backlog ${stats.queued} queued, oldest ${stats.oldestQueuedSeconds}s — drain may be stuck`,
    );
  }
}

export interface OrgMailRow {
  id: string;
  kind: string;
  to_address: string;
  subject: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  sent_at: Date | null;
}

/** The tenant's own last messages; RLS scopes it to the org. */
export async function listOrgQueue(ctx: Ctx, limit = 20): Promise<OrgMailRow[]> {
  return asTenant(ctx, async (client) => {
    const { rows } = await client.query<OrgMailRow>(
      `select id, kind, to_address, subject, status, attempts, last_error,
              created_at, sent_at
         from email_queue order by id desc limit $1`,
      [limit],
    );
    return rows;
  });
}
