import "server-only";
import { randomBytes } from "node:crypto";
import { parse } from "tldts";
import { withTenant, type Ctx } from "@chameleon/db";
import * as domains from "@chameleon/db";
import { asTenant, requireDb } from "./db";
import { hasMatch, lookupTxt, txtName, txtValue } from "./dns";
import { CfUnavailable, createCustomHostname, getCustomHostname } from "./cloudflare";
import { conflict, forbidden, invalid, notFound } from "./errors";
import { requireOwner } from "./session";
import type { HostnameView, OrgDomainView } from "@chameleon/contracts";

const MAX_LIVE = 250;

/**
 * A root is what the tenant buys DNS for, so the registrable domain is parsed,
 * not guessed by dot count (OPEN-TPL-01). `el-dept.co.uk` stays whole.
 */
export function normaliseRoot(raw: string): string {
  const value = raw.trim().toLowerCase().replace(/\.$/, "");
  if (value.startsWith("http")) {
    // A pasted URL may point at any page; the registrable root is the answer.
    try {
      const host = new URL(value).hostname.toLowerCase().replace(/\.$/, "");
      return parse(host, { allowPrivateDomains: true }).domain ?? host;
    } catch {
      throw invalid("bad_domain");
    }
  }
  return value;
}

export function assertRoot(raw: string): string {
  const root = normaliseRoot(raw);
  const parsed = parse(root, { allowPrivateDomains: true });
  if (!parsed.domain || !parsed.publicSuffix) throw invalid("bad_domain");
  if (parsed.domain !== root) throw invalid("use_root_domain");
  if (root.length > 253) throw invalid("bad_domain");
  return root;
}

/** A label only; the root supplies the rest. */
export function assertLabel(raw: string): string {
  const label = raw.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label) || label.length > 63) {
    throw invalid("bad_label");
  }
  return label;
}

/** Where a live tenant host must point. Fixed per platform, not per tenant. */
export function routingTarget(): string {
  return process.env.EDGE_CNAME_TARGET ?? "edge.mailerdeaon.bid";
}

const orgOrigin = (root: string): string => `https://${root}`;

/** The row plus the records the tenant must publish; both derived, never stored. */
export function domainView(row: domains.domains.OrgDomainRow): OrgDomainView {
  return {
    id: row.id,
    root: row.root,
    status: row.status,
    routingState: row.routing_state as OrgDomainView["routingState"],
    reviewNeeded: row.review_needed,
    verifyName: txtName(row.root),
    verifyValue: txtValue(row.verify_token),
    recordType: "TXT",
    ttl: 300,
    routing:
      row.status === "active" || row.status === "routing_waiting"
        ? { type: "CNAME", name: `*.${row.root}`, value: routingTarget() }
        : null,
    target: routingTarget(),
    detail: row.last_detail ?? null,
    checkedAt: row.last_checked_at ? row.last_checked_at.toISOString() : null,
    lastResult: (row.last_result as OrgDomainView["lastResult"]) ?? null,
    hostnameCount: row.hostname_count,
  };
}

function hostnameView(row: domains.domains.HostnameRow): HostnameView {
  return {
    id: row.id,
    domainId: row.domain_id,
    serviceId: row.service_id,
    fqdn: row.fqdn,
    label: row.label,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

export async function requestDomain(ctx: Ctx, raw: string): Promise<OrgDomainView> {
  requireOwner(ctx);
  const root = assertRoot(raw);
  if ((await enforceLiveLimit()) < 1) throw conflict("zone_full");

  return withTenant(requireDb(), ctx, async (c) => {
    // Both lookups must see other orgs, so they go through the bypassing
    // functions (0008/0025) rather than the tenant-visible table.
    const live = await c.query<{ id: string }>("select * from find_live_domain($1)", [
      root,
    ]);
    if (live.rows[0]) throw conflict("domain_exists");

    const tomb = await c.query<{ id: string; org_id: string }>(
      "select * from find_domain_tombstone($1)",
      [root],
    );
    const other = tomb.rows[0];
    if (other && other.org_id !== ctx.orgId) throw conflict("domain_tombstoned");
    if (other) {
      await c.query(
        `update org_domains
            set deleted_at = null, tombstoned_at = null, status = 'verifying',
                routing_state = 'dns_pending', last_checked_at = null, created_at = now(),
                verified_at = null, wildcard_cf_id = null
          where id = $1`,
        [other.id],
      );
      const revived = await domains.domains.getDomain(c, ctx, other.id);
      return domainView(revived);
    }

    const row = await domains.domains.addDomain(c, ctx, {
      root,
      verifyToken: randomBytes(24).toString("hex"),
    });
    return domainView(row);
  });
}

export interface CheckResult {
  status: string;
  detail: string;
}

/**
 * One check. TXT match is necessary; routing (a wildcard custom hostname) is the
 * separate step. Without the SaaS entitlement the root parks at
 * `routing_waiting` with the TXT already proven and promotes by itself once the
 * entitlement exists.
 */
export async function checkDomain(ctx: Ctx, id: string): Promise<CheckResult> {
  requireOwner(ctx);
  return withTenant(requireDb(), ctx, async (c) => {
    const row = await domains.domains.beginVerify(c, id, ctx.orgId);

    const name = txtName(row.root);
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
      if (row.status === "active") {
        await domains.domains.failDomain(c, id);
        return { status: "failed", detail };
      }
      return { status: "verifying", detail };
    }

    let wildcardId = row.wildcard_cf_id;
    try {
      if (!wildcardId) {
        const created = await createCustomHostname(`*.${row.root}`);
        wildcardId = created.id;
      }
      const current = await getCustomHostname(wildcardId);
      await domains.domains.markProven(c, id, wildcardId);
      if (current.status === "active") {
        await domains.domains.markRouting(c, id, wildcardId);
        await domains.domains.recordCheck(c, id, "match", "cf wildcard active");
        return { status: "active", detail: "verified" };
      }
      // Proven but not routed yet: the honest state is routing pending, not
      // "awaiting DNS" (the TXT is already there).
      await domains.domains.waitForRouting(c, id);
      await domains.domains.recordCheck(c, id, "match", `cf ${current.status}`);
      return {
        status: "routing_waiting",
        detail: `txt ok, cloudflare ${current.status}`,
      };
    } catch (error) {
      if (error instanceof CfUnavailable) {
        await domains.domains.markProven(c, id, wildcardId);
        if (error.code === "cf_entitlement_missing") {
          await domains.domains.waitForRouting(c, id);
          await domains.domains.recordCheck(c, id, "match", error.code);
          return { status: "routing_waiting", detail: "txt ok, routing pending" };
        }
        await domains.domains.recordCheck(c, id, "match", error.code);
        return { status: row.status, detail: `txt ok, ${error.code}` };
      }
      throw error;
    }
  });
}

export async function removeDomain(ctx: Ctx, id: string): Promise<void> {
  requireOwner(ctx);
  await withTenant(requireDb(), ctx, async (c) => {
    await domains.domains.getDomain(c, ctx, id);
    await domains.domains.softDeleteDomain(c, id);
  });
}

export async function getDomainView(ctx: Ctx, id: string): Promise<OrgDomainView> {
  return withTenant(requireDb(), ctx, async (c) =>
    domainView(await domains.domains.getDomain(c, ctx, id)),
  );
}

export interface CheckRow {
  id: string;
  result: string;
  detail: string | null;
  createdAt: string;
}

export async function listChecks(ctx: Ctx, domainId: string): Promise<CheckRow[]> {
  return asTenant(ctx, async (c) => {
    const { rows } = await c.query<CheckRow>(
      `select id::text, result, detail, created_at as "createdAt"
         from domain_checks where org_domain_id = $1
        order by created_at desc limit 20`,
      [domainId],
    );
    return rows;
  });
}

export async function listOrgDomains(ctx: Ctx): Promise<OrgDomainView[]> {
  const rows = await withTenant(requireDb(), ctx, (c) =>
    domains.domains.listDomains(c, ctx),
  );
  return rows.map(domainView);
}

export async function listHostnames(
  ctx: Ctx,
  serviceId: string,
): Promise<HostnameView[]> {
  const rows = await withTenant(requireDb(), ctx, (c) =>
    domains.domains.listHostnames(c, ctx, serviceId),
  );
  return rows.map(hostnameView);
}

/** Hostnames under one root with the service each belongs to. */
export async function listDomainHostnames(
  ctx: Ctx,
  domainId: string,
): Promise<Array<HostnameView & { serviceName: string }>> {
  return asTenant(ctx, async (c) => {
    const { rows } = await c.query<
      domains.domains.HostnameRow & { service_name: string }
    >(
      `select h.id, h.org_id, h.domain_id, h.service_id, h.fqdn, h.label, h.status,
              h.created_at, s.name as service_name
         from hostnames h join services s on s.id = h.service_id
        where h.domain_id = $1 and h.deleted_at is null
        order by h.created_at`,
      [domainId],
    );
    return rows.map((row) => ({
      ...hostnameView(row),
      serviceName: row.service_name,
    }));
  });
}

export async function addHostname(
  ctx: Ctx,
  serviceId: string,
  input: { domainId: string; label: string },
): Promise<HostnameView> {
  requireOwner(ctx);
  const label = assertLabel(input.label);

  return withTenant(requireDb(), ctx, async (c) => {
    const service = await c.query<{ status: string }>(
      "select status from services where id = $1",
      [serviceId],
    );
    if (!service.rows[0]) throw notFound();

    const domain = await c.query<{
      id: string;
      root: string;
      status: string;
      routing_state: string;
    }>(
      "select id, root, status, routing_state from org_domains where id = $1 and deleted_at is null",
      [input.domainId],
    );
    const root = domain.rows[0];
    if (!root) throw notFound();
    if (!["active", "routing_waiting"].includes(root.status)) {
      throw conflict("domain_not_verified");
    }

    const fqdn = `${label}.${root.root}`;
    const live = await c.query<{ id: string }>("select * from find_live_hostname($1)", [
      fqdn,
    ]);
    if (live.rows[0]) throw conflict("hostname_exists");
    const tomb = await c.query<{ id: string; org_id: string }>(
      "select * from find_hostname_tombstone($1)",
      [fqdn],
    );
    const other = tomb.rows[0];
    if (other && other.org_id !== ctx.orgId) throw conflict("hostname_tombstoned");
    if (other) {
      await c.query(
        `update hostnames
            set deleted_at = null, tombstoned_at = null, service_id = $2,
                label = $3, status = 'provisioning'
          where id = $1`,
        [other.id, serviceId, label],
      );
      const revived = await domains.domains.getHostname(c, ctx, other.id);
      return hostnameView(revived);
    }

    const row = await domains.domains.addHostname(c, ctx, {
      serviceId,
      domainId: input.domainId,
      label,
      fqdn,
    });
    return hostnameView(row);
  });
}

export async function removeHostname(ctx: Ctx, id: string): Promise<void> {
  requireOwner(ctx);
  await withTenant(requireDb(), ctx, async (c) => {
    await domains.domains.getHostname(c, ctx, id);
    await domains.domains.softDeleteHostname(c, id);
  });
}

/**
 * The job is the only cross-tenant path, so the due list uses the definer. It
 * runs every 5 minutes from the chameleon-domains timer.
 */
export async function runJob(): Promise<{
  checked: number;
  expired: number;
  failed: number;
}> {
  const c = await requireDb().pool.connect();
  let due: domains.domains.VerifyRow[] = [];
  let expired = 0;
  try {
    expired = await domains.domains.expireStale(c);
    due = await domains.domains.dueForCheck(c, 25);
  } finally {
    c.release();
  }

  await requireDb()
    .pool.query("select sweep_services()")
    .catch(() => undefined);

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

export interface DomainIssue {
  id: string;
  hostname: string;
  status: string;
  detail: string | null;
}

/** Roots the tenant must act on: failed checks, or an unproven TXT. */
export async function troubleDomains(ctx: Ctx): Promise<DomainIssue[]> {
  return asTenant(ctx, async (c) => {
    const { rows } = await c.query<DomainIssue>(
      `select d.id, d.root as hostname, d.status,
              (select detail from domain_checks where org_domain_id = d.id
                order by created_at desc limit 1) as detail
         from org_domains d
        where d.deleted_at is null and d.status in ('failed', 'verifying')
          and d.last_checked_at is not null
        order by d.last_checked_at desc limit 5`,
    );
    return rows;
  });
}

export { orgOrigin };
