import { redirect } from "next/navigation";
import { requirePageSession } from "../../../server/session";
import {
  listOrgDomains,
  removeDomain,
  requestDomain,
  routingTarget,
} from "../../../server/domains";
import { listServices } from "../../../server/services";
import { DnsRecords } from "../../../components/dns-record";
import { ConfirmSubmit } from "../../../components/shell";
import { Empty, PageHeader, StatusPill } from "../../../components/ui";

function codeOf(error: unknown): string {
  return (error as { code?: string }).code ?? "not_found";
}

export default async function DomainsPage() {
  const session = await requirePageSession();
  const [domains, services] = await Promise.all([
    listOrgDomains(session),
    listServices(session),
  ]);
  const active = services.filter((service) => service.status === "active");

  async function add(formData: FormData) {
    "use server";
    const ctx = await requirePageSession();
    const serviceId = String(formData.get("serviceId") ?? "");
    try {
      await requestDomain(ctx, serviceId, String(formData.get("hostname") ?? ""));
    } catch (error) {
      redirect(`/settings/domains?error=${codeOf(error)}`);
    }
    redirect("/settings/domains?added=1");
  }

  async function remove(formData: FormData) {
    "use server";
    const ctx = await requirePageSession();
    try {
      await removeDomain(ctx, String(formData.get("domainId") ?? ""));
    } catch (error) {
      redirect(`/settings/domains?error=${codeOf(error)}`);
    }
    redirect("/settings/domains?removed=1");
  }

  const grouped = new Map<string, typeof domains>();
  for (const domain of domains) {
    const list = grouped.get(domain.serviceType) ?? [];
    list.push(domain);
    grouped.set(domain.serviceType, list);
  }

  return (
    <main className="app" id="content">
      <PageHeader
        crumbs={[{ href: "/settings", label: "Configuration" }, { label: "Domains" }]}
        title="Domains"
        lede={`Every hostname the platform answers for. Point routing at ${routingTarget()} after the ownership record is proven.`}
      />
      {active.length > 0 ? (
        <p className="note info">
          Add hostnames per service. A hostname attached to one service never answers for
          another.
        </p>
      ) : null}

      {domains.length === 0 ? (
        <Empty title="No hostnames yet">
          Add one below once a service is activated. Nothing resolves until both records
          are published and checked.
        </Empty>
      ) : (
        <div className="stack">
          {[...grouped.entries()].map(([type, list]) => (
            <section key={type}>
              <h2>{type}</h2>
              {list.map((domain) => (
                <div className="card" key={domain.id}>
                  <div className="row" style={{ marginBottom: "0.7rem" }}>
                    <div>
                      <strong className="mono">{domain.hostname}</strong>
                      <div className="fine">
                        <a href={`/services/${domain.serviceId}#domains`}>Open service</a>
                      </div>
                    </div>
                    <StatusPill status={domain.status} />
                  </div>
                  <DnsRecords
                    domain={domain}
                    serviceId={domain.serviceId}
                    returnTo="/settings/domains"
                  />
                  <div className="actions" style={{ marginTop: "0.8rem" }}>
                    <form action={remove}>
                      <input type="hidden" name="domainId" value={domain.id} />
                      <ConfirmSubmit
                        message={`Delete ${domain.hostname}? Links on it stop resolving and the name is tombstoned for 30 days.`}
                      >
                        Delete
                      </ConfirmSubmit>
                    </form>
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}

      <section className="section">
        <h2>Add a hostname</h2>
        {active.length === 0 ? (
          <p className="muted">
            Activation comes first. <a href="/services">Open a service</a> and activate
            it.
          </p>
        ) : (
          <form action={add} className="card">
            <div className="field-row">
              <div className="field">
                <label htmlFor="serviceId">Service</label>
                <select id="serviceId" name="serviceId" required>
                  {active.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.serviceType} · {service.tier}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="hostname">Hostname</label>
                <input
                  id="hostname"
                  name="hostname"
                  placeholder="login.acme.com"
                  required
                />
              </div>
            </div>
            <p className="fine">
              No scheme, no path. Use a subdomain unless your provider supports CNAME at
              the apex.
            </p>
            <button type="submit" className="btn">
              Add hostname
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
