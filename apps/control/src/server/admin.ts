import "server-only";
import { requireDb } from "./db";
import { forbidden } from "./errors";
import type { PlatformSession } from "./session";
import {
  listQueue,
  mailStats,
  requeue,
  type MailStats,
  type QueueRow,
} from "./mailqueue";

function assertAdmin(session: PlatformSession): void {
  if (!session.isAdmin) throw forbidden("admin_only");
}

export interface Overview {
  orgs: number;
  services: number;
  active: number;
  unpaid: number;
  captures: number;
}

export interface AdminOrg {
  orgId: string;
  orgName: string;
  ownerEmail: string | null;
  createdAt: Date;
  services: number;
  captures: number;
  paid: number;
}

export interface AdminService {
  serviceId: string;
  orgName: string;
  ownerEmail: string | null;
  status: string;
  tier: string;
  expiresAt: Date | null;
  paidUntil: Date | null;
  captures: number;
  createdAt: Date;
}

export interface AdminPayment {
  id: string;
  status: string;
  price: number;
  provider: string | null;
  created: string;
  periodEnd: string;
}

export interface AdminServiceDetail {
  serviceId: string;
  orgId: string;
  orgName: string;
  ownerEmail: string | null;
  status: string;
  tier: string;
  paidUntil: Date | null;
  expiresAt: Date | null;
  adminNote: string | null;
  captures: number;
  payments: AdminPayment[];
}

/** Counters are cheap and cross-tenant by definition; the definer owns them. */
export async function overview(session: PlatformSession): Promise<Overview> {
  assertAdmin(session);
  const { rows } = await requireDb().pool.query<Overview>(
    "select * from admin_overview()",
  );
  return rows[0] ?? { orgs: 0, services: 0, active: 0, unpaid: 0, captures: 0 };
}

export async function listOrgs(session: PlatformSession): Promise<AdminOrg[]> {
  assertAdmin(session);
  const { rows } = await requireDb().pool.query<AdminOrg>(
    `select org_id as "orgId", org_name as "orgName", owner_email as "ownerEmail",
            created_at as "createdAt", services, captures, paid
     from admin_orgs()`,
  );
  return rows;
}

export async function listAllServices(session: PlatformSession): Promise<AdminService[]> {
  assertAdmin(session);
  const { rows } = await requireDb().pool.query<AdminService>(
    `select service_id as "serviceId", org_name as "orgName", owner_email as "ownerEmail",
            status, tier, expires_at as "expiresAt", paid_until as "paidUntil",
            captures, created_at as "createdAt"
     from admin_services()`,
  );
  return rows;
}

export async function serviceDetail(
  session: PlatformSession,
  serviceId: string,
): Promise<AdminServiceDetail | null> {
  assertAdmin(session);
  const { rows } = await requireDb().pool.query<AdminServiceDetail>(
    `select service_id as "serviceId", org_id as "orgId", org_name as "orgName",
            owner_email as "ownerEmail", status, tier, paid_until as "paidUntil",
            expires_at as "expiresAt", admin_note as "adminNote", captures, payments
     from admin_service_detail($1)`,
    [serviceId],
  );
  return rows[0] ?? null;
}

async function audit(
  session: PlatformSession,
  action: string,
  subject: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await requireDb()
    .pool.query("select admin_audit($1, $2, $3, $4)", [
      session.userId,
      action,
      subject,
      detail,
    ])
    .catch(() => undefined);
}

export async function extendDays(
  session: PlatformSession,
  serviceId: string,
  days: number,
): Promise<void> {
  assertAdmin(session);
  await requireDb().pool.query("select admin_extend_days($1, $2)", [serviceId, days]);
  await audit(session, "service.comp_days", serviceId, { days });
}

export async function setStatus(
  session: PlatformSession,
  serviceId: string,
  status: string,
): Promise<void> {
  assertAdmin(session);
  await requireDb().pool.query("select admin_set_service_status($1, $2)", [
    serviceId,
    status,
  ]);
  await audit(session, "service.status", serviceId, { status });
}

export async function setNote(
  session: PlatformSession,
  serviceId: string,
  note: string,
): Promise<void> {
  assertAdmin(session);
  await requireDb().pool.query("select admin_set_note($1, $2)", [serviceId, note]);
  await audit(session, "service.note", serviceId, { note });
}

export async function mailQueue(session: PlatformSession): Promise<QueueRow[]> {
  assertAdmin(session);
  return listQueue();
}

export async function retryQueued(session: PlatformSession, id: string): Promise<void> {
  assertAdmin(session);
  await requeue(id);
  await audit(session, "mail.requeue", id);
}

/** Backlog depth for the operator overview. */
export async function mailSummary(session: PlatformSession): Promise<MailStats> {
  assertAdmin(session);
  return mailStats();
}

export interface AuditRow {
  id: number;
  actorId: string | null;
  action: string;
  targetId: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

/** Operator actions are append-only and readable only here. */
export async function recentAudit(
  session: PlatformSession,
  limit = 50,
): Promise<AuditRow[]> {
  assertAdmin(session);
  const { rows } = await requireDb().pool.query<AuditRow>(
    `select id, actor_id as "actorId", action, target_id as "targetId",
            detail, created_at as "createdAt"
       from admin_audit_recent($1)`,
    [limit],
  );
  return rows;
}

export interface AdminTenant {
  orgId: string;
  orgName: string;
  ownerEmail: string | null;
  createdAt: Date;
  services: number;
  captures: number;
  domains: number;
  hostnames: number;
  lastSeen: Date;
}

/** Tenant-first search: name, owner address or exact id. */
export async function searchTenants(
  session: PlatformSession,
  q: string,
): Promise<AdminTenant[]> {
  assertAdmin(session);
  const { rows } = await requireDb().pool.query<AdminTenant>(
    `select org_id as "orgId", org_name as "orgName", owner_email as "ownerEmail",
            created_at as "createdAt", services, captures, domains, hostnames,
            last_seen as "lastSeen"
       from admin_tenants($1)`,
    [q.trim() || null],
  );
  return rows;
}

export interface AdminTenantService {
  id: string;
  name: string;
  status: string;
  tier: string;
  previewKey: string;
  linkCap: number;
  hostnameCap: number;
  linksUsed: number;
  hostnamesUsed: number;
  paidUntil: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface AdminTenantDomain {
  id: string;
  root: string;
  status: string;
  routingState: string;
  createdAt: string;
}

export interface AdminTenantHostname {
  id: string;
  fqdn: string;
  status: string;
  serviceName: string;
  createdAt: string;
}

export interface AdminTenantForward {
  id: string;
  email: string;
  status: string;
  createdAt: string;
}

export interface AdminTenantDetail {
  org: {
    id: string;
    name: string;
    createdAt: string;
    notifyEmail: string | null;
    notifyEnabled: boolean;
    notifyVerifiedAt: string | null;
  };
  owner: string | null;
  services: AdminTenantService[];
  domains: AdminTenantDomain[];
  hostnames: AdminTenantHostname[];
  forwards: AdminTenantForward[];
  audit: AuditRow[];
}

export async function tenantDetail(
  session: PlatformSession,
  orgId: string,
): Promise<AdminTenantDetail | null> {
  assertAdmin(session);
  const { rows } = await requireDb().pool.query<{ detail: AdminTenantDetail }>(
    "select admin_org_detail($1) as detail",
    [orgId],
  );
  return rows[0]?.detail ?? null;
}
