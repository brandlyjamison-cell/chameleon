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
    console.warn(`[mail] no provider, dropped: ${mail.subject} -> ${mail.to}`);
    return false;
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
