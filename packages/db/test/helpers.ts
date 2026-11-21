import pg from "pg";

export let migrator: pg.Pool;
export let appRw: pg.Pool;
export let edgeRo: pg.Pool;
export let admin: pg.Pool;

export interface Seed {
  orgId: string;
  otherOrgId: string;
  userId: string;
  serviceId: string;
  otherServiceId: string;
  domainId: string;
  linkId: string;
}

let seq = 0;

export async function connect(): Promise<void> {
  const migratorUrl = process.env.DATABASE_URL_TEST;
  const rwUrl = process.env.DATABASE_URL_APP_RW;
  const edgeUrl = process.env.DATABASE_URL_EDGE_RO;
  const adminUrl = process.env.DATABASE_URL_ADMIN;
  if (!migratorUrl || !rwUrl || !edgeUrl || !adminUrl) {
    throw new Error("DATABASE_URL_TEST, _APP_RW, _EDGE_RO and _ADMIN are required");
  }
  migrator = new pg.Pool({ connectionString: migratorUrl, max: 30 });
  appRw = new pg.Pool({ connectionString: rwUrl, max: 30 });
  edgeRo = new pg.Pool({ connectionString: edgeUrl, max: 4 });
  admin = new pg.Pool({ connectionString: adminUrl, max: 4 });
}

export async function disconnect(): Promise<void> {
  await Promise.all([migrator?.end(), appRw?.end(), edgeRo?.end(), admin?.end()]);
}

export async function reset(): Promise<void> {
  await migrator.query(
    "truncate auth_session, auth_verification, auth_account, auth_user, orgs, users, brands, audit_log, outbox, idempotency, webhook_events restart identity cascade",
  );
  await migrator.query(
    `update tiers set link_cap = 5, domain_cap = 2, capture_cap = 50000 where id in (1, 3)`,
  );
  await migrator.query(
    `update tiers set link_cap = 20, domain_cap = 5, capture_cap = 250000 where id in (2, 4)`,
  );
}

/** Seeds two orgs with one active service each. Uses the bypassing admin role. */
export async function seed(): Promise<Seed> {
  const n = (seq += 1);
  const org = await admin.query<{ id: string }>(
    `insert into orgs (name, slug) values ($1, $2) returning id`,
    [`org ${n}`, `org-${n}`],
  );
  const other = await admin.query<{ id: string }>(
    `insert into orgs (name, slug) values ($1, $2) returning id`,
    [`other ${n}`, `other-${n}`],
  );
  const user = await admin.query<{ id: string }>(
    `insert into users (email) values ($1) returning id`,
    [`owner${n}@example.test`],
  );
  const orgId = org.rows[0]!.id;
  const otherOrgId = other.rows[0]!.id;
  const userId = user.rows[0]!.id;

  await admin.query(
    `insert into memberships (org_id, user_id, role) values ($1, $2, 'owner')`,
    [orgId, userId],
  );

  const service = await admin.query<{ id: string }>(
    `insert into services (org_id, service_type_id, tier_id, status, expires_at)
     values ($1, 1, 1, 'active', now() + interval '30 days') returning id`,
    [orgId],
  );
  const otherService = await admin.query<{ id: string }>(
    `insert into services (org_id, service_type_id, tier_id, status, expires_at)
     values ($1, 1, 2, 'active', now() + interval '30 days') returning id`,
    [otherOrgId],
  );
  const serviceId = service.rows[0]!.id;
  const otherServiceId = otherService.rows[0]!.id;

  const domain = await admin.query<{ id: string }>(
    `insert into domains (org_id, service_id, hostname, verify_token, status, verified_at, verified_by)
     values ($1, $2, $3, 'tok', 'active', now(), 'txt') returning id`,
    [orgId, serviceId, `d${n}.example.test`],
  );
  const domainId = domain.rows[0]!.id;

  const link = await admin.query<{ id: string }>(
    `insert into links (org_id, service_id, domain_id, slug) values ($1, $2, $3, $4) returning id`,
    [orgId, serviceId, domainId, `A${String(n).padStart(4, "0")}`],
  );

  return {
    orgId,
    otherOrgId,
    userId,
    serviceId,
    otherServiceId,
    domainId,
    linkId: link.rows[0]!.id,
  };
}

/** A client with the GUC already set, for direct SQL assertions. */
export async function tenantClient(orgId: string): Promise<pg.PoolClient> {
  const client = await appRw.connect();
  await client.query("begin");
  await client.query("select set_config('app.org_id', $1, true)", [orgId]);
  return client;
}
