import { overview, recentAudit, searchTenants } from "../../server/admin";
import { requireAdminPage } from "../../server/session";
import { PageHeader, shortDate, shortTime } from "../../components/ui";

export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireAdminPage();
  const { q = "" } = await searchParams;
  const [counts, tenants, audit] = await Promise.all([
    overview(session),
    searchTenants(session, q),
    recentAudit(session, 8),
  ]);

  return (
    <main className="app wide" id="content">
      <PageHeader
        eyebrow="Platform"
        title="Tenants"
        lede="Cross-tenant by definition. Find the tenant first, then open its services, domains and forwarding from one place."
      />

      <div className="tiles">
        <div className="tile">
          <strong>{counts.orgs}</strong>
          <span className="muted">tenants</span>
        </div>
        <div className="tile">
          <strong>{counts.services}</strong>
          <span className="muted">services</span>
        </div>
        <div className="tile">
          <strong>{counts.active}</strong>
          <span className="muted">active</span>
        </div>
        <div className="tile">
          <strong>{counts.unpaid}</strong>
          <span className="muted">unpaid</span>
        </div>
        <div className="tile">
          <strong>{counts.captures}</strong>
          <span className="muted">captures</span>
        </div>
      </div>

      <form action="/admin" className="inline-form" style={{ margin: "1rem 0" }}>
        <div className="field grow">
          <label htmlFor="q">Search tenants</label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder="Name, owner email or exact tenant id"
            autoComplete="off"
          />
        </div>
        <button type="submit" className="btn">
          Search
        </button>
      </form>

      <div className="table orgs">
        {tenants.map((tenant) => (
          <a className="tr" key={tenant.orgId} href={`/admin/tenants/${tenant.orgId}`}>
            <div>
              <strong>{tenant.orgName}</strong>
              <div className="fine" title={tenant.ownerEmail ?? undefined}>
                {tenant.ownerEmail ?? "no owner"}
              </div>
            </div>
            <span className="muted">{tenant.services} services</span>
            <span className="muted">
              {tenant.domains} domains · {tenant.hostnames} hostnames
            </span>
            <span className="muted">{tenant.captures} captures</span>
            <span className="muted">last seen {shortTime(tenant.lastSeen)}</span>
            <span className="muted">joined {shortDate(tenant.createdAt)}</span>
          </a>
        ))}
        {tenants.length === 0 ? (
          <p className="muted">{q ? "No tenant matches that." : "No tenants yet."}</p>
        ) : null}
      </div>

      <section className="section">
        <h2>Recent operator actions</h2>
        {audit.length === 0 ? (
          <p className="muted">Nothing recorded yet.</p>
        ) : (
          <div className="stack">
            {audit.map((row) => (
              <div key={row.id}>
                <strong className="mono">{row.action}</strong>
                <div className="fine">
                  {row.targetId.slice(0, 18)} · {shortTime(row.createdAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
