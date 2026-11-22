import { notFound, redirect } from "next/navigation";
import { requireAdminPage } from "../../../../server/session";
import { extendDays, setNote, setStatus, tenantDetail } from "../../../../server/admin";
import { PageHeader, StatusPill, shortDate, shortTime } from "../../../../components/ui";

/**
 * Tenant detail. One page carries the whole account so an operator never has to
 * hunt across three lists: services, domains, hostnames, forwarding, audit.
 */
export default async function AdminTenant({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const session = await requireAdminPage();
  const { orgId } = await params;
  const detail = await tenantDetail(session, orgId);
  if (!detail) notFound();

  async function act(formData: FormData) {
    "use server";
    const ctx = await requireAdminPage();
    const serviceId = String(formData.get("serviceId") ?? "");
    const kind = String(formData.get("kind") ?? "");
    const back = `/admin/tenants/${orgId}`;
    if (kind === "note") {
      await setNote(ctx, serviceId, String(formData.get("note") ?? ""));
    } else if (kind === "days") {
      await extendDays(ctx, serviceId, Number(formData.get("days") ?? 0));
    } else {
      await setStatus(ctx, serviceId, String(formData.get("status") ?? "active"));
    }
    redirect(back);
  }

  return (
    <main className="app wide" id="content">
      <PageHeader
        crumbs={[{ href: "/admin", label: "Tenants" }, { label: detail.org.name }]}
        eyebrow="Tenant"
        title={detail.org.name}
        lede={`Owner ${detail.owner ?? "none"} · joined ${shortDate(detail.org.createdAt)} · ${detail.org.id}`}
        actions={
          detail.org.notifyEnabled ? (
            <span className="pill ok">
              Forwarding on → {detail.org.notifyEmail ?? "no address"}
            </span>
          ) : (
            <span className="pill idle">Forwarding off</span>
          )
        }
      />

      <div className="tiles">
        <div className="tile">
          <strong>{detail.services.length}</strong>
          <span className="muted">services</span>
        </div>
        <div className="tile">
          <strong>{detail.domains.length}</strong>
          <span className="muted">domains</span>
        </div>
        <div className="tile">
          <strong>{detail.hostnames.length}</strong>
          <span className="muted">hostnames</span>
        </div>
        <div className="tile">
          <strong>{detail.forwards.length}</strong>
          <span className="muted">forward addresses</span>
        </div>
      </div>

      <section className="section">
        <h2>Services</h2>
        <div className="table">
          {detail.services.map((service) => (
            <div className="tr" key={service.id} style={{ alignItems: "start" }}>
              <div>
                <a href={`/admin/${service.id}`}>
                  <strong>{service.name}</strong>
                </a>
                <div className="fine">
                  {service.tier} · created {shortDate(service.createdAt)}
                </div>
              </div>
              <StatusPill status={service.status} />
              <span className="muted">
                {service.linksUsed}/{service.linkCap} links · {service.hostnamesUsed}/
                {service.hostnameCap} hostnames
              </span>
              <span className="muted">
                {service.paidUntil ? `paid to ${shortDate(service.paidUntil)}` : "unpaid"}
                {service.expiresAt ? ` · clock ${shortDate(service.expiresAt)}` : ""}
              </span>
              <div className="stack">
                <form action={act} className="inline-form">
                  <input type="hidden" name="serviceId" value={service.id} />
                  <input type="hidden" name="kind" value="days" />
                  <input
                    name="days"
                    type="number"
                    defaultValue={30}
                    min={1}
                    max={365}
                    style={{ width: "5rem" }}
                  />
                  <button type="submit" className="btn ghost sm">
                    Comp days
                  </button>
                </form>
                <form action={act} className="inline-form">
                  <input type="hidden" name="serviceId" value={service.id} />
                  <input
                    type="hidden"
                    name="status"
                    value={service.status === "suspended" ? "active" : "suspended"}
                  />
                  <button type="submit" className="btn ghost sm">
                    {service.status === "suspended" ? "Restore" : "Suspend"}
                  </button>
                </form>
                <form action={act} className="inline-form">
                  <input type="hidden" name="serviceId" value={service.id} />
                  <input type="hidden" name="kind" value="note" />
                  <input name="note" placeholder="Note" defaultValue="" />
                  <button type="submit" className="btn ghost sm">
                    Save note
                  </button>
                </form>
              </div>
            </div>
          ))}
          {detail.services.length === 0 ? <p className="muted">No services.</p> : null}
        </div>
      </section>

      <div className="duo">
        <section className="card">
          <h2>Domains</h2>
          {detail.domains.length === 0 ? (
            <p className="muted">None.</p>
          ) : (
            <div className="table">
              {detail.domains.map((domain) => (
                <div className="tr" key={domain.id}>
                  <strong className="mono">{domain.root}</strong>
                  <StatusPill status={domain.status} />
                  <span className="muted">{domain.routingState}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h2>Hostnames</h2>
          {detail.hostnames.length === 0 ? (
            <p className="muted">None.</p>
          ) : (
            <div className="table">
              {detail.hostnames.map((host) => (
                <div className="tr" key={host.id}>
                  <strong className="mono">{host.fqdn}</strong>
                  <StatusPill status={host.status} />
                  <span className="muted">{host.serviceName}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="duo" style={{ marginTop: "1.1rem" }}>
        <section className="card">
          <h2>Forwarding</h2>
          {detail.forwards.length === 0 ? (
            <p className="muted">No addresses.</p>
          ) : (
            <div className="table">
              {detail.forwards.map((forward) => (
                <div className="tr" key={forward.id}>
                  <strong className="mono">{forward.email}</strong>
                  <StatusPill status={forward.status} />
                  <span className="muted">{shortDate(forward.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h2>Audit</h2>
          {detail.audit.length === 0 ? (
            <p className="muted">Nothing recorded.</p>
          ) : (
            <div className="stack">
              {detail.audit.map((row) => (
                <div key={row.id}>
                  <strong className="mono">{row.action}</strong>
                  <div className="fine">{shortTime(row.createdAt)}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
