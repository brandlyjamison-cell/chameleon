import { redirect } from "next/navigation";
import { requirePageSession } from "../../server/session";
import { listServices } from "../../server/services";
import { Empty, PageHeader, StatusPill, money, shortDate } from "../../components/ui";

export default async function Services() {
  const session = await requirePageSession();
  if (!session.orgId) redirect("/welcome");
  const services = await listServices(session);

  const live = services.filter((service) => service.status !== "archived");
  const archived = services.filter((service) => service.status === "archived");

  return (
    <main className="app" id="content">
      <PageHeader
        title="Products & services"
        lede="Each service is a separate capture surface with its own domains, links and vault slice."
        actions={
          <a className="btn" href="/services/new">
            New service
          </a>
        }
      />

      {services.length === 0 ? (
        <Empty
          title="Nothing provisioned yet"
          action={
            <a className="btn" href="/services/new">
              Create a service
            </a>
          }
        >
          Start with a Chameleon service. You pick a tier, pay one 30-day period and only
          then does the service activate with its own four-digit passcode.
        </Empty>
      ) : null}

      {live.length > 0 ? (
        <div className="bento">
          {live.map((service) => (
            <article className="card" key={service.id}>
              <div className="row">
                <h2 style={{ margin: 0 }}>{service.name}</h2>
                <StatusPill
                  status={service.subscription === "due" ? "past_due" : service.status}
                />
              </div>
              <dl className="kv" style={{ marginTop: "0.8rem" }}>
                <dt>Tier</dt>
                <dd>
                  {service.tier} · {money(service.priceCents)} / 30 days
                </dd>
                <dt>Period</dt>
                <dd>
                  {service.paidUntil
                    ? `Paid through ${shortDate(service.paidUntil)}`
                    : "Payment due"}
                </dd>
                <dt>Passcode</dt>
                <dd>{service.activatedAt ? "Set" : "Not activated"}</dd>
              </dl>
              <div className="actions" style={{ marginTop: "0.9rem" }}>
                <a className="btn sm" href={`/services/${service.id}`}>
                  Manage service
                </a>
                <a className="btn ghost sm" href={`/vault?service=${service.id}`}>
                  Vault
                </a>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {archived.length > 0 ? (
        <section className="section">
          <h2>Archived</h2>
          <div className="table">
            {archived.map((service) => (
              <div className="tr" key={service.id}>
                <a href={`/services/${service.id}`}>
                  <strong>{service.name}</strong>
                  <span className="muted"> {service.serviceType}</span>
                </a>
                <StatusPill
                  status={service.subscription === "due" ? "past_due" : service.status}
                />
                <span className="muted">{service.tier}</span>
                <span className="muted">{shortDate(service.createdAt)}</span>
                <span />
                <a className="btn ghost sm" href={`/services/${service.id}`}>
                  Open
                </a>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
