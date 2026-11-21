import "server-only";
import { requireDb } from "./db";
import { forbidden } from "./errors";
import type { PlatformSession } from "./session";

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

export async function extendDays(
  session: PlatformSession,
  serviceId: string,
  days: number,
): Promise<void> {
  assertAdmin(session);
  await requireDb().pool.query("select admin_extend_days($1, $2)", [serviceId, days]);
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
}

export async function setNote(
  session: PlatformSession,
  serviceId: string,
  note: string,
): Promise<void> {
  assertAdmin(session);
  await requireDb().pool.query("select admin_set_note($1, $2)", [serviceId, note]);
}
