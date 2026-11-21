import { randomBytes } from "node:crypto";
import { requireDb } from "./db";

/** Stands in for "no org chosen yet"; casts cleanly and matches nothing. */
export const NULL_ORG = "00000000-0000-0000-0000-000000000000";

function slugOf(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return `${base || "org"}-${randomBytes(3).toString("hex")}`;
}

/**
 * Signup provisioning, resumable: if the person already has a membership the
 * existing org wins. The unique owner index makes a double run safe.
 */
export async function ensureOrg(userId: string, orgName: string): Promise<string> {
  const client = await requireDb().pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id', $1, true)", [userId]);
    await client.query("select set_config('app.org_id', $1, true)", [NULL_ORG]);

    const existing = await client.query<{ org_id: string }>(
      "select org_id from memberships where user_id = $1 limit 1",
      [userId],
    );
    const found = existing.rows[0];
    if (found) {
      await client.query("commit");
      return found.org_id;
    }

    const org = await client.query<{ id: string }>(
      "insert into orgs (name, slug) values ($1, $2) returning id",
      [orgName, slugOf(orgName)],
    );
    const orgId = org.rows[0]!.id;
    await client.query("select set_config('app.org_id', $1, true)", [orgId]);
    await client.query(
      "insert into memberships (org_id, user_id, role) values ($1, $2, 'owner')",
      [orgId, userId],
    );
    await client.query("commit");
    return orgId;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
