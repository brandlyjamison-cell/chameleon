import { redirect } from "next/navigation";
import { requireAdminPage } from "../../server/session";
import {
  listAllServices,
  listOrgs,
  mailSummary,
  overview,
  recentAudit,
  setStatus,
} from "../../server/admin";
import { PageHeader, StatusPill, shortDate, shortTime } from "../../components/ui";

export default async function Admin() {
  const session = await requireAdminPage();
  const [counts, orgs, services, mail, audit] = await Promise.all([
    overview(session),
    listOrgs(session),
    listAllServices(session),
    mailSummary(session),
    recentAudit(session, 8),
  ]);

  async function toggle(formData: FormData) {
    "use server";
    const ctx = await requireAdminPage();
    const id = String(formData.get("id") ?? "");
    const next = formData.get("next") === "suspend" ? "suspended" : "active";
    await setStatus(ctx, id, next);
    redirect("/admin");
  }

  return (
    <main className="app wide" id="content">
      <PageHeader
        eyebrow="Platform"
        title="Operator panel"
        lede="Cross-tenant by definition. Captures stay unreadable here: the operator sees counts and money, not plaintext."
        actions={
          <>
            <a className="btn ghost" href="/admin/mail">
              Mail queue
            </a>
            <a className="btn ghost" href="/admin/audit">
              Audit log
            </a>
          </>
        }
      />

      <div className="tiles">
        <div className="tile">
          <strong>{counts.orgs}</strong>
          <span className="muted">orgs</span>
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

      <section className="section">
        <div className="split">
          <div className="card">
            <div className="row">
              <h2>Mail</h2>
              <a className="btn ghost sm" href="/admin/mail">
                Open queue
              </a>
            </div>
            <div className="tiles">
              <div className="tile">
                <strong>{mail.queued}</strong>
                <span className="muted">queued</span>
              </div>
              <div className="tile">
                <strong>{mail.sending}</strong>
                <span className="muted">sending</span>
              </div>
              <div className="tile">
                <strong>{mail.failed24h}</strong>
                <span className="muted">failed 24h</span>
              </div>
              <div className="tile">
                <strong>{Math.round(mail.oldestQueuedSeconds / 60)}</strong>
                <span className="muted">oldest, minutes</span>
              </div>
            </div>
            {mail.oldestQueuedSeconds > 300 ? (
              <p className="error" role="alert" style={{ marginTop: "0.8rem" }}>
                Backlog is older than five minutes. The drain itself may be stuck, not
                just the provider.
              </p>
            ) : null}
          </div>

          <div className="card">
            <div className="row">
              <h2>Recent operator actions</h2>
              <a className="btn ghost sm" href="/admin/audit">
                All
              </a>
            </div>
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
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Services</h2>
        <div className="table">
          {services.map((service) => (
            <div className="tr" key={service.serviceId}>
              <a href={`/admin/${service.serviceId}`}>
                <strong>{service.orgName}</strong>
                <div className="fine">{service.ownerEmail ?? "no owner"}</div>
              </a>
              <StatusPill status={service.status} />
              <span className="muted">{service.tier}</span>
              <span className="muted">
                {service.paidUntil ? `paid to ${shortDate(service.paidUntil)}` : "unpaid"}
              </span>
              <span className="muted">{service.captures} captures</span>
              <form action={toggle}>
                <input type="hidden" name="id" value={service.serviceId} />
                <input
                  type="hidden"
                  name="next"
                  value={service.status === "suspended" ? "restore" : "suspend"}
                />
                <button type="submit" className="btn ghost sm">
                  {service.status === "suspended" ? "Restore" : "Suspend"}
                </button>
              </form>
            </div>
          ))}
          {services.length === 0 && <p className="muted">No services yet.</p>}
        </div>
      </section>

      <section className="section">
        <h2>Orgs</h2>
        <div className="table orgs">
          {orgs.map((org) => (
            <div className="tr" key={org.orgId}>
              <div>
                <strong>{org.orgName}</strong>
                <div className="fine" title={org.ownerEmail ?? undefined}>
                  {org.ownerEmail ?? "no owner"}
                </div>
              </div>
              <span className="muted">{org.services} services</span>
              <span className="muted">{org.captures} captures</span>
              <span className="muted">${(org.paid / 100).toFixed(2)} paid</span>
              <span className="muted">{shortDate(org.createdAt)}</span>
            </div>
          ))}
          {orgs.length === 0 && <p className="muted">No orgs yet.</p>}
        </div>
      </section>
    </main>
  );
}
