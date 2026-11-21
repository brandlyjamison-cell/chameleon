import "server-only";
import { createDb, withTenant, type Ctx } from "@chameleon/db";

const url = process.env.DATABASE_URL ?? process.env.DATABASE_URL_APP_RW;

/** `app_rw`: every query is under RLS, and the GUC comes from the session. */
export const db = url ? createDb(url, 6) : null;

export function requireDb(): NonNullable<typeof db> {
  if (!db) throw new Error("DATABASE_URL is not set");
  return db;
}

export function asTenant<T>(
  ctx: Ctx,
  fn: Parameters<typeof withTenant<T>>[2],
): Promise<T> {
  return withTenant(requireDb(), ctx, fn);
}
