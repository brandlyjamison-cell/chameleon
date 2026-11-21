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
  for (const row of rows) {
    const ok = await sendMail({
      to: row.to_address,
      subject: row.subject,
      text: row.text_body,
      ...(row.html_body ? { html: row.html_body } : {}),
    });
    await requireDb()
      .pool.query("select finish_email($1, $2, $3)", [
        row.id,
        ok,
        ok ? null : "provider refused",
      ])
      .catch(() => undefined);
    if (ok) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}
