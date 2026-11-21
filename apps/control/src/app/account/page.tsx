import { requirePageSession } from "../../server/session";
import { getOrg } from "../../server/account";
import { PageHeader, StatusPill, shortDate } from "../../components/ui";

export default async function Account() {
  const session = await requirePageSession();
  const org = await getOrg(session);

  return (
    <main className="app narrow" id="content">
      <PageHeader
        crumbs={[{ href: "/dashboard", label: "Overview" }, { label: "Account" }]}
        title="Account"
        lede="The signed-in identity and its role. One login owns one org (ADR 0022)."
      />

      <div className="card">
        <dl className="kv">
          <dt>Email</dt>
          <dd>{session.email}</dd>
          <dt>Email state</dt>
          <dd>
            {session.emailVerified ? (
              <StatusPill status="verified" />
            ) : (
              <StatusPill status="pending" />
            )}
          </dd>
          <dt>Role</dt>
          <dd>{session.role ?? "none"}</dd>
          <dt>Organisation</dt>
          <dd>
            {org.name} · <span className="mono">{org.slug}</span>
          </dd>
          <dt>Organisation since</dt>
          <dd>{shortDate(org.createdAt)}</dd>
        </dl>
      </div>

      <div className="card">
        <h2>Session</h2>
        <p className="muted">
          Sessions end after 30 minutes idle and 12 hours absolute, whichever comes first.
          The cookie is host-only and `Secure`.
        </p>
        <form action="/api/logout" method="post">
          <button type="submit" className="btn ghost">
            Sign out
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Vault passcode</h2>
        <p className="muted">
          Each service has its own four-digit passcode set at activation. There is no
          platform-wide recovery: the wrapped key is only openable with the service
          passcode.
        </p>
        <a className="btn ghost" href="/services">
          Choose a service
        </a>
      </div>

      {session.isAdmin ? (
        <div className="card">
          <h2>Operator</h2>
          <p className="muted">
            This identity also carries the platform flag, which unlocks the cross-tenant
            panel.
          </p>
          <a className="btn ghost" href="/admin">
            Open operator panel
          </a>
        </div>
      ) : null}
    </main>
  );
}
