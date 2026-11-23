import "server-only";
import { createHash } from "node:crypto";
import { asTenant } from "./db";
import { invalid, conflict } from "./errors";
import { requireOwner } from "./session";
import * as store from "@chameleon/db";
import type { Ctx } from "@chameleon/db";

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_KEY;
const base = process.env.CF_API_BASE ?? "https://api.cloudflare.com/client/v4";

const MAX_HTML = 700_000;
const MAX_SHOT = 2_000_000;
const MAX_LOGO = 300_000;

export interface CloneResult {
  id: string;
  brandName: string;
  emailDomain: string;
}

function assertUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw invalid("bad_url");
  }
  if (url.protocol !== "https:") throw invalid("bad_url");
  if (!url.hostname.includes(".")) throw invalid("bad_url");
  return url;
}

async function render(url: string, kind: "content" | "screenshot"): Promise<Response> {
  if (!account || !token) throw invalid("cloner_unavailable");
  const res = await fetch(`${base}/accounts/${account}/browser-rendering/${kind}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      url,
      gotoOptions: { waitUntil: "networkidle0", timeout: 20000 },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw conflict("clone_failed");
  return res;
}

interface Parsed {
  title: string;
  brandName: string;
  stepCount: 1 | 2;
  redirectTo: string;
  palette: Record<string, string>;
  labels: Record<string, string>;
  logoUrl: string | null;
}

const text = (value: string): string =>
  value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

function first(html: string, pattern: RegExp): string | null {
  const match = pattern.exec(html);
  return match?.[1] ? text(match[1]) : null;
}

function colour(html: string, pattern: RegExp): string | null {
  const match = pattern.exec(html);
  return match?.[1] ?? null;
}

/** A readable clone, not a pixel copy: form shape, words, logo and colours. */
export function parseLogin(html: string, url: URL): Parsed {
  const title = first(html, /<title[^>]*>([\s\S]{0,200}?)<\/title>/i) ?? url.hostname;
  const heading =
    first(html, /<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i) ??
    first(html, /<h2[^>]*>([\s\S]{0,200}?)<\/h2>/i) ??
    "Sign in";
  const emailLabel =
    first(html, /<label[^>]*for="[^"]*e-?mail[^"]*"[^>]*>([\s\S]{0,120}?)<\/label>/i) ??
    first(html, /<input[^>]*type="email"[^>]*placeholder="([^"]{1,60})"/i) ??
    "Email";
  const passwordLabel =
    first(html, /<label[^>]*for="[^"]*pass[^"]*"[^>]*>([\s\S]{0,120}?)<\/label>/i) ??
    first(html, /<input[^>]*type="password"[^>]*placeholder="([^"]{1,60})"/i) ??
    "Password";
  const submit =
    first(html, /<button[^>]*type="submit"[^>]*>([\s\S]{0,80}?)<\/button>/i) ??
    first(html, /<input[^>]*type="submit"[^>]*value="([^"]{1,60})"/i) ??
    "Sign in";

  // Two forms, or a password-less email form next to a password form: two steps.
  const forms = html.match(/<form\b/gi)?.length ?? 0;
  const stepCount: 1 | 2 = forms >= 2 ? 2 : 1;

  const action = /<form[^>]*action="([^"]+)"/i.exec(html)?.[1];
  let redirectTo = url.origin;
  if (action) {
    try {
      redirectTo = new URL(action, url).toString();
    } catch {
      redirectTo = url.origin;
    }
  }

  const theme = colour(
    html,
    /<meta[^>]*name="theme-color"[^>]*content="(#[0-9a-f]{3,8})"/i,
  );
  const background = colour(
    html,
    /(?:background(?:-color)?|--(?:bg|background|surface))\s*:\s*(#[0-9a-f]{3,8})/i,
  );
  const foreground = colour(html, /(?:^|[;{"\s])color\s*:\s*(#[0-9a-f]{3,8})/i);

  const logo = /<(?:img|link)[^>]*(?:logo|icon)[^>]*(?:src|href)="([^"]+)"/i.exec(
    html,
  )?.[1];
  const og = /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i.exec(html)?.[1];
  let logoUrl: string | null = null;
  for (const candidate of [logo, og]) {
    if (!candidate || candidate.startsWith("data:")) continue;
    try {
      const absolute = new URL(candidate, url).toString();
      if (absolute.startsWith("https://")) {
        logoUrl = absolute;
        break;
      }
    } catch {
      // try the next candidate
    }
  }

  return {
    title: title.slice(0, 120),
    brandName: url.hostname.replace(/^www\./, "").split(".")[0] ?? url.hostname,
    stepCount,
    redirectTo,
    palette: {
      ...(background ? { bg: background, surface: "#ffffff" } : {}),
      ...(foreground ? { fg: foreground } : {}),
      ...(theme ? { accent: theme } : {}),
      radius: "8px",
      font: "system-ui, sans-serif",
    },
    labels: { heading, email: emailLabel, password: passwordLabel, submit },
    logoUrl,
  };
}

async function bytesOf(url: string, cap: number): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.byteLength > cap ? null : buffer;
  } catch {
    return null;
  }
}

/**
 * Fetches the real page, derives a template and stores the artefacts. The clone
 * is a reviewable profile, never a silent replacement (ADR 0034).
 */
export async function cloneLogin(
  ctx: Ctx,
  serviceId: string,
  rawUrl: string,
): Promise<CloneResult> {
  requireOwner(ctx);
  const url = assertUrl(rawUrl);
  const emailDomain = url.hostname.toLowerCase().replace(/^www\./, "");

  const [page, shot] = await Promise.all([
    render(url.toString(), "content"),
    render(url.toString(), "screenshot"),
  ]);
  const body = (await page.json()) as { success?: boolean; result?: string };
  if (!body.success || !body.result) throw conflict("clone_failed");
  const html = body.result.slice(0, MAX_HTML);
  const png = Buffer.from(await shot.arrayBuffer());
  if (png.byteLength > MAX_SHOT) throw conflict("clone_too_large");

  const parsed = parseLogin(html, url);
  if (!/<input[^>]*type="password"/i.test(html)) throw conflict("no_password_field");

  return asTenant(ctx, async (c) => {
    const profile = await store.profiles.create(c, ctx, {
      serviceId,
      emailDomain,
      profile: {
        brand_slug: emailDomain.replace(/\./g, "-"),
        template_key: "generic",
        redirect_to: parsed.redirectTo,
        palette: parsed.palette,
        labels: parsed.labels,
        title: parsed.title,
      },
      stepCount: parsed.stepCount,
      sourceUrl: url.toString(),
      brandName: parsed.brandName,
      fetchedFrom: "browser_rendering",
    });

    const shotId = await store.profiles.addAsset(
      c,
      ctx,
      profile.id,
      "screenshot",
      "image/png",
      png,
      createHash("sha256").update(png).digest(),
    );
    let logoId: string | null = null;
    if (parsed.logoUrl) {
      const logo = await bytesOf(parsed.logoUrl, MAX_LOGO);
      if (logo) {
        logoId = await store.profiles.addAsset(
          c,
          ctx,
          profile.id,
          "logo",
          "image/png",
          logo,
          createHash("sha256").update(logo).digest(),
        );
      }
    }
    await store.profiles.point(c, ctx, profile.id, {
      screenshotAssetId: shotId,
      logoAssetId: logoId,
    });

    // The newest clone becomes what the preview shows, until a brand is pinned.
    const preview = await c.query<{ id: string }>(
      `select id from links where service_id = $1 and is_preview and deleted_at is null`,
      [serviceId],
    );
    if (preview.rows[0]) {
      await c.query("update links set profile_id = $2 where id = $1", [
        preview.rows[0].id,
        profile.id,
      ]);
    }

    return { id: profile.id, brandName: parsed.brandName, emailDomain };
  });
}

export async function reviewProfile(
  ctx: Ctx,
  profileId: string,
  status: "accepted" | "rejected",
): Promise<void> {
  requireOwner(ctx);
  await asTenant(ctx, (c) => store.profiles.setStatus(c, ctx, profileId, status));
}

/** Puts a rejected clone back in the running after an operator fix. */
export async function reopenProfile(ctx: Ctx, profileId: string): Promise<void> {
  requireOwner(ctx);
  await asTenant(ctx, async (c) => {
    const profile = await store.profiles.get(c, ctx, profileId);
    await store.profiles.setStatus(c, ctx, profile.id, "generated");
  });
}
