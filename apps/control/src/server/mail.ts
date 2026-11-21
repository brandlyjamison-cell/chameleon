import "server-only";

const endpoint = "https://api.cloudflare.com/client/v4/accounts";

/**
 * Cloudflare Email Service. Never throws: a mail failure must not fail a signup,
 * because `/api/verify/resend` exists. Verification links are also teed to
 * `MAIL_SINK` so the suite can read them without a provider.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendMail(mail: Mail): Promise<boolean> {
  const token = process.env.CLOUDFLARE_EMAIL_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const from = process.env.MAIL_FROM ?? `noreply@${process.env.DOMAIN ?? "localhost"}`;

  const sink = process.env.MAIL_SINK;
  if (sink) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(
      sink,
      `${JSON.stringify({ to: mail.to, url: firstUrl(mail.text) })}\n`,
    );
  }
  if (!token || !account) {
    // With a sink present the message is as delivered as it needs to be: the
    // suite reads the sink, not an inbox.
    if (!sink) console.warn(`[mail] no provider, dropped: ${mail.subject} -> ${mail.to}`);
    return Boolean(sink);
  }

  try {
    const res = await fetch(`${endpoint}/${account}/email/sending/send`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        to: mail.to,
        from: { address: from, name: "Chameleon" },
        subject: mail.subject,
        text: mail.text,
        ...(mail.html ? { html: mail.html } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error(`[mail] ${res.status} ${await res.text()}`.slice(0, 400));
      return false;
    }
    return true;
  } catch (error) {
    console.error("[mail]", (error as Error).message);
    return false;
  }
}

function firstUrl(text: string): string {
  return text.match(/https?:\/\/\S+/)?.[0] ?? "";
}

/** Shared shell so mail is not a naked paragraph. */
export function shell(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#0b0f13;padding:32px;font:16px/1.6 system-ui,sans-serif;color:#e8eef5">
  <table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#111820;border-radius:14px;padding:28px">
    <tr><td>
      <p style="margin:0 0 18px;font:600 13px system-ui;letter-spacing:.14em;text-transform:uppercase;color:#6ee7a8">Chameleon</p>
      <h1 style="margin:0 0 14px;font-size:22px">${title}</h1>
      ${body}
      <p style="margin:26px 0 0;font-size:13px;color:#7e8b99">If this was not you, nothing is broken — ignore it.</p>
    </td></tr>
  </table></body></html>`;
}

export function button(url: string, label: string): string {
  return `<p style="margin:0 0 18px"><a href="${url}" style="display:inline-block;background:#6ee7a8;color:#07110c;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:9px">${label}</a></p>`;
}

export interface Message {
  subject: string;
  text: string;
  html: string;
}

export function verificationMail(email: string, url: string): Message {
  return {
    subject: "Confirm your Chameleon address",
    text: `Confirm ${email} to finish setting up Chameleon:
${url}

The link is good for 24 hours.`,
    html: shell(
      "Confirm your address",
      `<p style="margin:0 0 18px;color:#b6c2cf">One click and ${email} stops being provisional. The link is good for 24 hours.</p>${button(url, "Confirm address")}`,
    ),
  };
}

export function forwardVerificationMail(email: string, url: string): Message {
  return {
    subject: "Confirm this forwarding address",
    text: `Make ${email} a forwarding target for your Chameleon captures:
${url}

Until you confirm, captures can only go to the address on your account. The link is good for 24 hours.`,
    html: shell(
      "Confirm this forwarding address",
      `<p style="margin:0 0 18px;color:#b6c2cf">Make <strong>${email}</strong> a forwarding target for your capture vault. Until you confirm, captures can only go to the address on your account. The link is good for 24 hours.</p>${button(url, "Confirm address")}`,
    ),
  };
}

export function receiptMail(input: {
  serviceType: string;
  amountCents: number;
  periodEnd: Date;
  invoiceId: string;
}): Message {
  const amount = `$${(input.amountCents / 100).toFixed(2)}`;
  const until = input.periodEnd.toISOString().slice(0, 10);
  return {
    subject: `Payment received — ${input.serviceType}, ${amount}`,
    text: `We received ${amount} for your ${input.serviceType} service.
Period ends ${until}. Reference ${input.invoiceId}.

Nothing auto-charges; a renewal invoice is minted before the period ends.`,
    html: shell(
      "Payment received",
      `<p style="margin:0 0 10px;color:#b6c2cf">We received <strong>${amount}</strong> for your ${input.serviceType} service. The period ends <strong>${until}</strong>.</p>
       <p style="margin:0 0 18px;color:#7e8b99;font-size:14px">Reference ${input.invoiceId}. Nothing auto-charges; a renewal invoice is minted before the period ends.</p>`,
    ),
  };
}

export function captureMail(input: {
  serviceType: string;
  receivedAt: Date;
  fields: Record<string, unknown>;
  source: string;
}): Message {
  const rows = Object.entries(input.fields)
    .filter(([, value]) => value !== null && value !== "" && typeof value !== "object")
    .map(
      ([key, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#7e8b99">${escapeHtml(key)}</td><td style="padding:4px 0"><code>${escapeHtml(String(value))}</code></td></tr>`,
    )
    .join("");
  const text = Object.entries(input.fields)
    .filter(([, value]) => value !== null && value !== "" && typeof value !== "object")
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("\n");
  return {
    subject: `Capture — ${input.serviceType}`,
    text: `Captured ${input.receivedAt.toISOString()} (${input.source}).

${text}

Plaintext is mail-only; the vault stays the source of truth.`,
    html: shell(
      "Capture received",
      `<p style="margin:0 0 14px;color:#b6c2cf">${input.serviceType} · ${input.receivedAt.toISOString()} · ${input.source}</p>
       <table style="border-collapse:collapse;font:14px ui-monospace,monospace;color:#e8eef5">${rows || "<tr><td>no scalar fields</td></tr>"}</table>
       <p style="margin:18px 0 0;color:#7e8b99;font-size:13px">Plaintext is mail-only; the vault stays the source of truth.</p>`,
    ),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
