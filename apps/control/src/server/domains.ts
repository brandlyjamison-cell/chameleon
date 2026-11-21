import "server-only";
import { randomBytes } from "node:crypto";
import { withTenant, type Ctx } from "@chameleon/db";
import * as domains from "@chameleon/db";
import { requireDb } from "./db";
import { hasMatch, lookupTxt, txtName, txtValue } from "./dns";
import { CfUnavailable, createCustomHostname, getCustomHostname } from "./cloudflare";
import { conflict, forbidden, invalid, notFound } from "./errors";
import { requireOwner } from "./session";
import type { DomainView } from "@chameleon/contracts";

const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export function normaliseHostname(raw: string): string {
  const host = raw.trim().toLowerCase().replace(/\.$/, "");
  if (host.startsWith("http")) {
    const parsed = new URL(host);
    return parsed.hostname.toLowerCase();
  }
  return host;
}

export function assertHostname(raw: string): string {
  const host = normaliseHostname(raw);
  if (!HOSTNAME.test(host)) throw invalid("bad_hostname");
  if (host.split(".").length < 2) throw invalid("bad_hostname");
  return host;
}

const MAX_LIVE = 250;

export async function requestDomain(ctx: Ctx, serviceId: string, raw: string) {
  requireOwner(ctx);
  const hostname = assertHostname(raw);
  // Zone-wide ceiling, checked before the per-service slot (INV-EDGE-07).
  if ((await enforceLiveLimit()) < 1) throw conflict("zone_full");
  return withTenant(requireDb(), ctx, async (c) => {
    const { rows: svc } = await c.query<{ status: string }>(
      "select status from services where id = $1",
      [serviceId],
    );
    if (!svc[0]) throw notFound();
    // A hostname points at a live service, so provisioning is not enough.
    if (svc[0].status !== "active") throw conflict("service_not_active");

    // Both lookups must see other orgs, so they go through the BYPASSRLS
    // functions (0008) rather than the tenant-visible table.
    const live = await c.query<{ id: string }>("select * from find_live_domain($1)", [
      hostname,
    ]);
    if (live.rows[0]) throw conflict("domain_exists");

    const tomb = await c.query<{ id: string; org_id: string }>(
      "select * from find_domain_tombstone($1)",
      [hostname],
    );
    const other = tomb.rows[0];
    if (other && other.org_id !== ctx.orgId) throw conflict("domain_tombstoned");
    if (other) {
      // Same org: revive the row, keep the token, restart the clock.
      await c.query(
        `update domains set deleted_at = null, tombstoned_at = null, status = 'verifying',
           last_checked_at = null, created_at = now(), verified_at = null, cf_hostname_id = null
         where id = $1`,
        [other.id],
      );
      const { rows } = await c.query<domains.domains.DomainRow>(
        `select id, org_id, service_id, hostname, status, verify_token
         from domains where id = $1`,
        [other.id],
      );
      return domainView(rows[0]!);
    }

    const row = await domains.domains.add(c, ctx, {
      serviceId,
      hostname,
      verifyToken: randomBytes(24).toString("hex"),
    });
    return domainView(row);
  });
}

/** The row plus the record the tenant must publish; both derived, never stored. */
export function domainView(
  row: domains.domains.DomainRow & { last_checked_at?: Date | null },
  detail: string | null = null,
): DomainView {
  return {
    id: row.id,
    hostname: row.hostname,
    status: row.status,
    verifyName: txtName(row.hostname),
    verifyValue: txtValue(row.verify_token),
    detail,
    checkedAt: row.last_checked_at ? row.last_checked_at.toISOString() : null,
  };
}

export interface CheckResult {
  status: string;
  detail: string;
}

/**
 * One check. TXT match is necessary, Cloudflare "active" is sufficient for
 * activation; without the SaaS entitlement the host stays `verifying` with the
 * TXT already proven (OPEN-OPS-04).
 */
export async function checkDomain(ctx: Ctx, id: string): Promise<CheckResult> {
  requireOwner(ctx);
  return withTenant(requireDb(), ctx, async (c) => {
    const row = await domains.domains.beginVerify(c, id);

    const name = txtName(row.hostname);
    let records: string[];
    try {
      records = await lookupTxt(name);
    } catch {
      await domains.domains.recordCheck(c, id, "error", "resolver unavailable");
      return { status: "verifying", detail: "resolver unavailable" };
    }

    if (!hasMatch(records, row.verify_token)) {
      const detail = `expected ${txtValue(row.verify_token)} at ${name}`;
      await domains.domains.recordCheck(c, id, "mismatch", detail);
      // A resolver blip returns earlier; a genuinely absent record on a live
      // host is a failure, and links on it must 404 (arch/edge.md).
      if (row.status === "active") {
        await domains.domains.fail(c, id);
        return { status: "failed", detail };
      }
      return { status: "verifying", detail };
    }

    let hostnameId = row.cf_hostname_id;
    try {
      if (!hostnameId) {
        const created = await createCustomHostname(row.hostname);
        hostnameId = created.id;
      }
      const current = await getCustomHostname(hostnameId);
      if (current.status === "active") {
        await domains.domains.markProven(c, id, hostnameId);
        await domains.domains.recordCheck(c, id, "match", "cf active");
        await domains.domains.promote(c, id);
        return { status: "active", detail: "verified" };
      }
      await domains.domains.markProven(c, id, hostnameId);
      await domains.domains.recordCheck(c, id, "match", `cf ${current.status}`);
      return { status: "verifying", detail: `txt ok, cloudflare ${current.status}` };
    } catch (error) {
      if (error instanceof CfUnavailable) {
        await domains.domains.markProven(c, id, hostnameId);
        await domains.domains.recordCheck(c, id, "match", error.code);
        return { status: "verifying", detail: `txt ok, ${error.code}` };
      }
      throw error;
    }
  });
}

export async function removeDomain(ctx: Ctx, id: string): Promise<void> {
  requireOwner(ctx);
  await withTenant(requireDb(), ctx, async (c) => {
    await domains.domains.get(c, ctx, id).catch(() => {
      throw notFound();
    });
    await domains.domains.softDelete(c, id);
  });
}

export async function listDomains(ctx: Ctx, serviceId: string): Promise<DomainView[]> {
  const rows = await withTenant(requireDb(), ctx, (c) =>
    domains.domains.listForService(c, ctx, serviceId),
  );
  return rows.map((row) => domainView(row));
}

/**
 * The job is the only cross-tenant path, so it uses the bypassing role. It runs
 * every 5 minutes from a systemd timer (ops/systemd/chameleon-domains.timer).
 */
export async function runJob(): Promise<{
  checked: number;
  expired: number;
  failed: number;
}> {
  // The due list is the only cross-tenant read, so it goes through the
  // SECURITY DEFINER function; every write below still runs under a tenant GUC.
  const c = await requireDb().pool.connect();
  let due: domains.domains.VerifyRow[] = [];
  let expired = 0;
  try {
    expired = await domains.domains.expireStale(c);
    due = await domains.domains.dueForCheck(c, 25);
  } finally {
    c.release();
  }

  let checked = 0;
  let failed = 0;
  for (const row of due) {
    try {
      await checkDomain({ orgId: row.org_id, userId: null, role: "owner" }, row.id);
      checked += 1;
    } catch {
      failed += 1;
    }
  }
  return { checked, expired, failed };
}

export async function enforceLiveLimit(): Promise<number> {
  const { rows } = await requireDb().pool.query<{ n: number }>(
    "select live_domain_count() as n",
  );
  return Math.max(0, MAX_LIVE - (rows[0]?.n ?? 0));
}

export { forbidden };
