import "server-only";
import { requireDb } from "./db";
import { sendMail } from "./mail";

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
 * payment webhook. `MAIL_INLINE` drains immediately, which keeps the suite's
 * sink deterministic without a timer.
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
  if (process.env.MAIL_INLINE) await drain(10).catch(() => undefined);
  return true;
}

/** Sends whatever is due. Backoff and the 6-try ceiling live in `finish_email`. */
export async function drain(limit = 20): Promise<DrainResult> {
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
  return { sent, failed, throttled };
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
