import "server-only";
import { cookies as nextCookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Ctx, Role } from "@chameleon/db";
import { auth } from "./auth";
import { asTenant, requireDb } from "./db";
import { conflict, forbidden, unauthorized } from "./errors";
import { NULL_ORG } from "./orgs";

export const ABSOLUTE_SESSION_MS = 12 * 60 * 60 * 1000;

export interface PlatformSession {
  readonly userId: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly orgId: string | null;
  readonly role: Role | null;
  readonly isAdmin: boolean;
}

type HeaderSource = { forEach(cb: (value: string, key: string) => void): void };

async function toHeaders(input?: HeaderSource): Promise<Headers> {
  const out = new Headers();
  if (input) {
    input.forEach((value, key) => out.set(key, value));
    return out;
  }
  // In a server component the request headers are not forwarded reliably, but the
  // cookie store always is.
  const jar = await nextCookies();
  out.set(
    "cookie",
    jar
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join("; "),
  );
  return out;
}

/**
 * The membership lookup runs with only `app.user_id` set: the org is what we are
 * trying to find, so there is no org GUC yet (INV-DATA-06).
 */
export async function membershipOf(
  userId: string,
): Promise<{ orgId: string; role: Role } | null> {
  const ctx: Ctx = { orgId: NULL_ORG, userId, role: "member" };
  return asTenant(ctx, async (c) => {
    await c.query("select set_config('app.user_id', $1, true)", [userId]);
    const { rows } = await c.query<{ org_id: string; role: Role }>(
      "select org_id, role from memberships where user_id = $1 limit 1",
      [userId],
    );
    const row = rows[0];
    return row ? { orgId: row.org_id, role: row.role } : null;
  });
}

export async function currentSession(
  headers?: HeaderSource,
): Promise<PlatformSession | null> {
  const h = await toHeaders(headers);
  const result = await auth.api.getSession({ headers: h });
  if (!result) return null;

  const created = new Date(result.session.createdAt).getTime();
  if (!Number.isFinite(created) || Date.now() - created > ABSOLUTE_SESSION_MS) {
    await auth.api.revokeSession({
      body: { token: result.session.token },
      headers: h,
    });
    return null;
  }

  const membership = await membershipOf(result.user.id);
  // `users` is the mirror row and carries the operator flag (ADR 0022).
  const admin = await requireDb().pool.query<{ is_admin: boolean }>(
    "select is_admin from users where id = $1",
    [result.user.id],
  );
  return {
    userId: result.user.id,
    email: result.user.email,
    emailVerified: Boolean(result.user.emailVerified),
    orgId: membership?.orgId ?? null,
    role: membership?.role ?? null,
    isAdmin: Boolean(admin.rows[0]?.is_admin),
  };
}

/** Tenant context for repos. Throws 401/409 rather than 404. */
/**
 * Pages: a missing or stale session is a redirect, never an error page. Routes
 * keep throwing 401 so an API caller can see the status.
 */
export async function requirePageSession(): Promise<
  Ctx & { emailVerified: boolean; email: string }
> {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.orgId || !session.role) redirect("/login");
  return {
    orgId: session.orgId,
    userId: session.userId,
    role: session.role,
    emailVerified: session.emailVerified,
    email: session.email,
  };
}

export async function requireSession(
  headers?: HeaderSource,
): Promise<Ctx & { emailVerified: boolean; email: string }> {
  const session = await currentSession(headers);
  if (!session) throw unauthorized();
  if (!session.orgId || !session.role) throw conflict("no_org");
  return {
    orgId: session.orgId,
    userId: session.userId,
    role: session.role,
    emailVerified: session.emailVerified,
    email: session.email,
  };
}

/** The operator panel is cross-tenant, so a page needs the flag, not a role. */
export async function requireAdminPage(): Promise<PlatformSession> {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.isAdmin) redirect("/services");
  return session;
}

/** Owner is the only role that can spend money (tier) or slots (hosts). */
export function requireOwner(ctx: Ctx): void {
  if (ctx.role !== "owner") throw forbidden("owner_only");
}
